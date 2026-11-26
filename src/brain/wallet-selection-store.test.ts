import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { WalletRanking } from "./wallet-ranking.js";
import { WalletSelectionStore } from "./wallet-selection-store.js";

function ranking(wallet: string, score: number): WalletRanking {
  return {
    wallet, quoteMint: "USDC", quoteDecimals: 6, rank: 1, reliabilityScore: score,
    eligible: true, status: "positive_history", matchedSellCount: 10,
    profitableSellCount: 8, losingSellCount: 2, winRatePercent: 80,
    realizedPnlRaw: "100", grossProfitRaw: "120", grossLossRaw: "20",
    profitFactor: "6.00", matchedMintCount: 3, activeDays: 3,
    profitableDays: 3, losingDays: 0, positiveDayRatePercent: 100,
    openPositionCount: 0, pnlIsGross: true,
  };
}

test("persists selected wallets across store restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wallet-watchlist-"));
  const filePath = join(directory, "watchlist.json");
  let time = new Date("2026-01-01T00:00:00.000Z");
  try {
    const first = new WalletSelectionStore({ filePath, now: () => time });
    await first.init();
    await first.sync([ranking("WalletA", 88)]);
    time = new Date("2026-01-02T00:00:00.000Z");
    const restarted = new WalletSelectionStore({ filePath, now: () => time });
    await restarted.init();
    const records = restarted.list();
    assert.equal(records.length, 1);
    assert.equal(records[0]?.active, true);
    assert.equal(records[0]?.firstSelectedAt, "2026-01-01T00:00:00.000Z");
    assert.equal(records[0]?.selectionCount, 1);
    assert.equal(JSON.parse(await readFile(filePath, "utf8")).version, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("marks removed wallets inactive and counts a later re-selection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wallet-watchlist-"));
  const filePath = join(directory, "watchlist.json");
  let time = new Date("2026-02-01T00:00:00.000Z");
  try {
    const store = new WalletSelectionStore({ filePath, now: () => time });
    await store.init();
    await store.sync([ranking("WalletA", 80)]);
    time = new Date("2026-02-02T00:00:00.000Z");
    await store.sync([]);
    assert.equal(store.list()[0]?.active, false);
    time = new Date("2026-02-03T00:00:00.000Z");
    await store.sync([ranking("WalletA", 90)]);
    assert.equal(store.list()[0]?.selectionCount, 2);
    assert.equal(store.list()[0]?.reliabilityScore, 90);
    assert.equal(store.list()[0]?.active, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
