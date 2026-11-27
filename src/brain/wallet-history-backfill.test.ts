import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WalletCandidateStore } from "./wallet-candidate-store.js";
import { WalletTradeStore } from "./wallet-trade-store.js";
import { WalletHistoryBackfill } from "./wallet-history-backfill.js";
import type { ParsedTrade } from "../decoder/types.js";

const wallet = "11111111111111111111111111111111";

test("backfill resumes from its saved signature cursor and deduplicates history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wallet-backfill-"));
  try {
    const candidates = new WalletCandidateStore({ filePath: join(directory, "candidates.json") });
    const trades = new WalletTradeStore({ filePath: join(directory, "trades.jsonl") });
    await candidates.init();
    await trades.init();
    await candidates.record({
      wallet, signature: "discovery-signature", slot: 1, mint: "TokenMint",
      side: "buy", tokenAmountRaw: "100",
    });

    const pages = new Map<string, Array<{ signature: string; slot: number; blockTime: number | null }>>([
      ["", [
        { signature: "history-1", slot: 10, blockTime: 1_700_000_001 },
        { signature: "history-2", slot: 9, blockTime: 1_700_000_000 },
      ]],
      ["history-2", []],
    ]);
    const connection = {
      getSignaturesForAddress: async (_address: unknown, options?: { before?: string; limit?: number }) =>
        (pages.get(options?.before ?? "") ?? []).slice(0, options?.limit ?? 1000),
    };
    const decoder = {
      decodeWalletCandidates: async (signature: string): Promise<ParsedTrade[]> => [{
        wallet, signature, mint: "TokenMint", side: "buy", amountIn: 1, amountOut: 0,
        tokenAmountRaw: "100", tokenDecimals: 6, quoteAmountRaw: "50",
        quoteMint: "QuoteMint", quoteDecimals: 6, quoteSource: "token_balance",
        quoteAmountIsEstimate: false, timestamp: 1_700_000_001,
      }],
    };
    const options = {
      connection: connection as never,
      decoder: decoder as never,
      candidates,
      trades,
      statePath: join(directory, "backfill.json"),
      walletsPerRun: 1,
      signaturesPerWalletRun: 2,
      maxSignaturesPerWallet: 10,
    };
    const first = new WalletHistoryBackfill(options);
    await first.init();
    assert.deepEqual(await first.runBatch(), {
      walletsVisited: 1, signaturesScanned: 2, tradesInserted: 2,
    });
    assert.equal(trades.count(), 2);

    const restarted = new WalletHistoryBackfill(options);
    await restarted.init();
    assert.deepEqual(await restarted.runBatch(), {
      walletsVisited: 1, signaturesScanned: 0, tradesInserted: 0,
    });
    assert.equal(trades.count(), 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
