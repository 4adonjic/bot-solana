import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateWalletPerformance, type PerformanceTrade } from "./wallet-performance.js";

const wallet = "WalletA";
const mint = "TokenMintA";
const wsol = "So11111111111111111111111111111111111111112";

function trade(
  side: "buy" | "sell",
  tokenAmountRaw: string,
  quoteAmountRaw: string,
  observedAt: string,
  extras: Partial<PerformanceTrade> = {},
): PerformanceTrade {
  return {
    wallet, mint, side, tokenAmountRaw, quoteAmountRaw,
    quoteMint: wsol, quoteDecimals: 9, quoteSource: "token_balance",
    quoteAmountIsEstimate: false, signature: observedAt, observedAt,
    ...extras,
  };
}

test("calculates FIFO realized PnL and remaining inventory", () => {
  const result = calculateWalletPerformance([
    trade("buy", "100", "1000", "2026-01-01T00:00:00.000Z"),
    trade("buy", "100", "2000", "2026-01-02T00:00:00.000Z"),
    trade("sell", "150", "4500", "2026-01-03T00:00:00.000Z"),
  ])[0];

  assert.ok(result);
  // First 100 tokens cost 1000; next 50 cost 1000; proceeds are 4500.
  assert.equal(result.realizedPnlRaw, "2500");
  assert.equal(result.openTokenRaw, "50");
  assert.equal(result.openCostBasisRaw, "1000");
  assert.equal(result.matchedSoldTokenRaw, "150");
  assert.equal(result.unmatchedSoldTokenRaw, "0");
});

test("marks sales without a known buy as unmatched instead of inventing profit", () => {
  const result = calculateWalletPerformance([
    trade("sell", "50", "900", "2026-01-01T00:00:00.000Z"),
  ])[0];

  assert.ok(result);
  assert.equal(result.realizedPnlRaw, "0");
  assert.equal(result.unmatchedSoldTokenRaw, "50");
  assert.equal(result.matchedSoldTokenRaw, "0");
});

test("excludes estimated native SOL and observations without quote amounts", () => {
  const result = calculateWalletPerformance([
    trade("buy", "100", "1000", "2026-01-01T00:00:00.000Z", {
      quoteMint: "SOL",
      quoteSource: "native_balance_estimate",
      quoteAmountIsEstimate: true,
    }),
    trade("buy", "100", "1000", "2026-01-02T00:00:00.000Z", {
      quoteAmountRaw: undefined,
    }),
  ]);

  assert.deepEqual(result, []);
});

test("does not mix cost basis across different quote assets", () => {
  const result = calculateWalletPerformance([
    trade("buy", "100", "1000", "2026-01-01T00:00:00.000Z"),
    trade("sell", "100", "1500", "2026-01-02T00:00:00.000Z", {
      quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      quoteDecimals: 6,
    }),
  ]);

  assert.equal(result.length, 2);
  assert.equal(result.find((item) => item.quoteMint === wsol)?.unmatchedSoldTokenRaw, "0");
  assert.equal(result.find((item) => item.quoteMint !== wsol)?.unmatchedSoldTokenRaw, "100");
});

test("allocates proceeds only to the matched part of a partial unmatched sale", () => {
  const result = calculateWalletPerformance([
    trade("buy", "40", "400", "2026-01-01T00:00:00.000Z"),
    trade("sell", "100", "2000", "2026-01-02T00:00:00.000Z"),
  ])[0];

  assert.ok(result);
  assert.equal(result.matchedSoldTokenRaw, "40");
  assert.equal(result.unmatchedSoldTokenRaw, "60");
  assert.equal(result.realizedPnlRaw, "400");
});

test("keeps raw integer arithmetic above JavaScript safe integer range", () => {
  const result = calculateWalletPerformance([
    trade("buy", "900719925474099300", "9007199254740993000", "2026-01-01T00:00:00.000Z"),
    trade("sell", "900719925474099300", "18014398509481986000", "2026-01-02T00:00:00.000Z"),
  ])[0];

  assert.ok(result);
  assert.equal(result.realizedPnlRaw, "9007199254740993000");
});
