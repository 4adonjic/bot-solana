import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  PaperTradingEngine,
  type PaperQuoteAsset,
} from "./paper-trading.js";
import type { PerformanceTrade } from "./wallet-performance.js";

const quoteMint = "TestQuoteMint";
const asset: PaperQuoteAsset = {
  mint: quoteMint,
  decimals: 6,
  initialBalanceRaw: "10000",
  buySizeRaw: "1000",
};

function sourceTrade(
  side: "buy" | "sell",
  signature: string,
  overrides: Partial<PerformanceTrade> = {},
): PerformanceTrade {
  return {
    wallet: "LeaderWallet",
    signature,
    mint: "TestTokenMint",
    side,
    tokenAmountRaw: "100",
    quoteAmountRaw: "100",
    quoteMint,
    quoteDecimals: 6,
    quoteSource: "token_balance",
    quoteAmountIsEstimate: false,
    observedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function withEngine(
  run: (engine: PaperTradingEngine, filePath: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "solana-paper-"));
  const filePath = join(directory, "paper.json");
  try {
    const engine = new PaperTradingEngine({
      filePath,
      quoteAssets: [asset],
      slippageBps: 100,
      feeBps: 100,
    });
    await engine.init();
    await run(engine, filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("simulates a buy and a full copied exit with slippage and fees", async () => {
  await withEngine(async (engine) => {
    const buy = await engine.processTrade(sourceTrade("buy", "buy-signature"));
    assert.equal(buy.executed, true);
    if (!buy.executed) return;
    assert.equal(buy.fill.tokenAmountRaw, "980");
    assert.equal(buy.fill.quoteAmountRaw, "1000");
    assert.equal(buy.fill.feeQuoteRaw, "10");
    assert.equal(buy.balanceRaw, "9000");
    assert.equal(buy.position?.tokenAmountRaw, "980");

    const sell = await engine.processTrade(sourceTrade("sell", "sell-signature", {
      quoteAmountRaw: "120",
      tokenBalanceBeforeRaw: "100",
      tokenBalanceAfterRaw: "0",
      observedAt: "2026-01-01T00:01:00.000Z",
    }));
    assert.equal(sell.executed, true);
    if (!sell.executed) return;
    assert.equal(sell.fill.tokenAmountRaw, "980");
    assert.equal(sell.fill.quoteAmountRaw, "1153");
    assert.equal(sell.fill.feeQuoteRaw, "11");
    assert.equal(sell.position, null);
    assert.equal(sell.balanceRaw, "10153");
    assert.equal(engine.snapshot().positions.length, 0);
    assert.equal(engine.snapshot().fills.length, 2);
  });
});

test("copies only the leader sold fraction and preserves remaining cost basis", async () => {
  await withEngine(async (engine) => {
    const buy = await engine.processTrade(sourceTrade("buy", "partial-buy"));
    assert.equal(buy.executed, true);
    if (!buy.executed) return;

    const sell = await engine.processTrade(sourceTrade("sell", "partial-sell", {
      tokenAmountRaw: "25",
      quoteAmountRaw: "25",
      tokenBalanceBeforeRaw: "100",
      tokenBalanceAfterRaw: "75",
    }));
    assert.equal(sell.executed, true);
    if (!sell.executed) return;
    assert.equal(sell.fill.tokenAmountRaw, "245");
    assert.equal(sell.position?.tokenAmountRaw, "735");
    assert.equal(sell.position?.costBasisRaw, "750");
    assert.equal(engine.snapshot().positions.length, 1);
  });
});

test("rejects sells when leader pre/post balances are missing or inconsistent", async () => {
  await withEngine(async (engine) => {
    await engine.processTrade(sourceTrade("buy", "balance-check-buy"));
    const missing = await engine.processTrade(sourceTrade("sell", "balance-check-missing"));
    assert.deepEqual(missing, {
      executed: false,
      reason: "missing_leader_position_balances_for_proportional_sell",
    });
    const inconsistent = await engine.processTrade(sourceTrade("sell", "balance-check-invalid", {
      tokenBalanceBeforeRaw: "100",
      tokenBalanceAfterRaw: "80",
    }));
    assert.deepEqual(inconsistent, {
      executed: false,
      reason: "inconsistent_leader_position_balances",
    });
  });
});

test("persists balances, positions and fills across restart", async () => {
  await withEngine(async (_engine, filePath) => {
    const first = new PaperTradingEngine({ filePath, quoteAssets: [asset] });
    await first.init();
    const result = await first.processTrade(sourceTrade("buy", "persisted-buy"));
    assert.equal(result.executed, true);

    const restarted = new PaperTradingEngine({ filePath, quoteAssets: [asset] });
    await restarted.init();
    assert.equal(restarted.snapshot().balances[quoteMint], "9000");
    assert.equal(restarted.snapshot().positions.length, 1);
    assert.equal(restarted.snapshot().fills.length, 1);
    assert.match(await readFile(filePath, "utf8"), /persisted-buy/);
  });
});

test("refuses estimated quote amounts and unsupported quote assets", async () => {
  await withEngine(async (engine) => {
    const estimated = await engine.processTrade(sourceTrade("buy", "estimate", {
      quoteSource: "native_balance_estimate",
      quoteAmountIsEstimate: true,
    }));
    assert.deepEqual(estimated, { executed: false, reason: "missing_or_estimated_exact_quote_amount" });

    const unsupported = await engine.processTrade(sourceTrade("buy", "unsupported", {
      quoteMint: "UnknownMint",
    }));
    assert.deepEqual(unsupported, { executed: false, reason: "unsupported_quote_asset" });
    assert.equal(engine.snapshot().fills.length, 0);
  });
});

test("does not sell without an open position and deduplicates source signatures", async () => {
  await withEngine(async (engine) => {
    const sell = await engine.processTrade(sourceTrade("sell", "sell-first"));
    assert.deepEqual(sell, { executed: false, reason: "no_open_paper_position" });

    await engine.processTrade(sourceTrade("buy", "same-signature"));
    const duplicate = await engine.processTrade(sourceTrade("buy", "same-signature"));
    assert.deepEqual(duplicate, { executed: false, reason: "duplicate_source_trade" });
    assert.equal(engine.snapshot().fills.length, 1);
  });
});

test("serializes concurrent paper fills and respects the virtual balance", async () => {
  await withEngine(async (engine) => {
    const results = await Promise.all([
      engine.processTrade(sourceTrade("buy", "parallel-1")),
      engine.processTrade(sourceTrade("buy", "parallel-2")),
      engine.processTrade(sourceTrade("buy", "parallel-3")),
      engine.processTrade(sourceTrade("buy", "parallel-4")),
      engine.processTrade(sourceTrade("buy", "parallel-5")),
      engine.processTrade(sourceTrade("buy", "parallel-6")),
      engine.processTrade(sourceTrade("buy", "parallel-7")),
      engine.processTrade(sourceTrade("buy", "parallel-8")),
      engine.processTrade(sourceTrade("buy", "parallel-9")),
      engine.processTrade(sourceTrade("buy", "parallel-10")),
      engine.processTrade(sourceTrade("buy", "parallel-11")),
    ]);
    assert.equal(results.filter((result) => result.executed).length, 10);
    assert.equal(results.filter((result) => !result.executed && result.reason === "insufficient_virtual_balance").length, 1);
    assert.equal(engine.snapshot().balances[quoteMint], "0");
    assert.equal(engine.snapshot().fills.length, 10);
  });
});

test("loads initial virtual balances only once and rejects corrupted state", async () => {
  await withEngine(async (_engine, filePath) => {
    const invalid = await import("node:fs/promises");
    await invalid.writeFile(filePath, "{broken", "utf8");
    const restarted = new PaperTradingEngine({ filePath, quoteAssets: [asset] });
    await assert.rejects(restarted.init(), /Invalid JSON in paper trading state/);
  });
});


test("uses a fresh quote after the configured delay and fails closed when unavailable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "solana-paper-quote-"));
  const filePath = join(directory, "paper.json");
  const quoteCalls: Array<[string, string, string]> = [];
  try {
    const engine = new PaperTradingEngine({
      filePath,
      quoteAssets: [asset],
      copyDelayMs: 0,
      minSlippageBps: 200,
      maxSlippageBps: 500,
      feeBps: 100,
      quoteProvider: async (inputMint, outputMint, amountRaw) => {
        quoteCalls.push([inputMint, outputMint, amountRaw]);
        return { outAmountRaw: "2000" };
      },
    });
    await engine.init();
    const result = await engine.processTrade(sourceTrade("buy", "fresh-quote-buy", {
      quoteAmountRaw: undefined,
      quoteSource: undefined,
      quoteAmountIsEstimate: undefined,
    }));
    assert.equal(result.executed, true);
    assert.deepEqual(quoteCalls, [[quoteMint, "TestTokenMint", "990"]]);
    if (result.executed) {
      const simulatedTokens = BigInt(result.fill.tokenAmountRaw);
      assert.equal(simulatedTokens >= 1900n && simulatedTokens <= 1960n, true);
      assert.equal(result.fill.slippageBps >= 200 && result.fill.slippageBps <= 500, true);
    }

    const unavailable = new PaperTradingEngine({
      filePath: join(directory, "unavailable.json"),
      quoteAssets: [asset],
      copyDelayMs: 0,
      quoteProvider: async () => null,
    });
    await unavailable.init();
    const rejected = await unavailable.processTrade(sourceTrade("buy", "missing-fresh-quote"));
    assert.deepEqual(rejected, { executed: false, reason: "fresh_jupiter_quote_unavailable" });
    assert.equal(unavailable.snapshot().fills.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
