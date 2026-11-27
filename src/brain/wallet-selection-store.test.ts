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
    openPositionCount: 0,
    closedTradeCount14d: 10,
    realizedPnl14dRaw: "100",
    medianTradePnlRaw: "10",
    medianHoldingSeconds: 300,
    maxProfitConcentrationPercent: 25,
    maxDrawdownRaw: "20", pnlIsGross: true,
  };
}

test("persists selected wallets across store restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wallet-watchlist-"));
  const filePath = join(directory, "watchlist.json");
  let time = new Date("2026-01-01T00:00:00.000Z");
  try {
    const first = new WalletSelectionStore({ filePath, now: () => time });
    await first.init();
    await first.sync([ranking("WalletA", 88)], [ranking("WalletA", 88)]);
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
    await store.sync([ranking("WalletA", 80)], [ranking("WalletA", 80)]);
    time = new Date("2026-02-02T00:00:00.000Z");
    await store.sync([], []);
    assert.equal(store.list()[0]?.active, false);
    time = new Date("2026-02-03T00:00:00.000Z");
    await store.sync([ranking("WalletA", 90)], [ranking("WalletA", 90)]);
    assert.equal(store.list()[0]?.selectionCount, 2);
    assert.equal(store.list()[0]?.reliabilityScore, 90);
    assert.equal(store.list()[0]?.active, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("pauses a wallet after a sharp score decline and resumes after recovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wallet-watchlist-trend-"));
  const filePath = join(directory, "watchlist.json");
  let time = new Date("2026-03-01T00:00:00.000Z");
  try {
    const store = new WalletSelectionStore({ filePath, now: () => time });
    await store.init();
    await store.sync([ranking("WalletTrend", 86)], [ranking("WalletTrend", 86)]);
    assert.equal(store.list()[0]?.active, true);
    assert.equal(store.list()[0]?.trend, "stable");

    time = new Date("2026-03-02T00:00:00.000Z");
    await store.sync([ranking("WalletTrend", 74)], [ranking("WalletTrend", 74)]);
    assert.equal(store.list()[0]?.active, false);
    assert.equal(store.list()[0]?.trend, "declining");
    assert.deepEqual(store.list()[0]?.scoreHistory, [86, 74]);

    time = new Date("2026-03-03T00:00:00.000Z");
    await store.sync([ranking("WalletTrend", 86)], [ranking("WalletTrend", 86)]);
    assert.equal(store.list()[0]?.active, true);
    assert.equal(store.list()[0]?.trend, "stable");
    assert.equal(store.list()[0]?.selectionCount, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("loads old watchlist entries without score history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wallet-watchlist-migration-"));
  const filePath = join(directory, "watchlist.json");
  try {
    const legacy = {
      version: 1,
      wallets: {
        '["WalletLegacy","USDC"]': {
          wallet: "WalletLegacy",
          quoteMint: "USDC",
          reliabilityScore: 77,
          firstSelectedAt: "2026-04-01T00:00:00.000Z",
          lastSelectedAt: "2026-04-01T00:00:00.000Z",
          selectionCount: 1,
          active: true
        }
      }
    };
    await (await import("node:fs/promises")).writeFile(filePath, JSON.stringify(legacy), "utf8");
    const store = new WalletSelectionStore({ filePath });
    await store.init();
    assert.deepEqual(store.list()[0]?.scoreHistory, [77]);
    assert.equal(store.list()[0]?.trend, "stable");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
