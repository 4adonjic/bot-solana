import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateWalletPerformance, type PerformanceTrade } from "./wallet-performance.js";
import { rankWallets } from "./wallet-ranking.js";

const wsol = "So11111111111111111111111111111111111111112";
const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function makeTrade(
  wallet: string,
  mint: string,
  side: "buy" | "sell",
  quoteAmountRaw: string,
  signature: string,
  observedAt: string,
  quoteMint = wsol,
): PerformanceTrade {
  return {
    wallet,
    mint,
    side,
    tokenAmountRaw: "100",
    quoteAmountRaw,
    quoteMint,
    quoteDecimals: quoteMint === wsol ? 9 : 6,
    quoteSource: "token_balance",
    quoteAmountIsEstimate: false,
    signature,
    observedAt,
  };
}

test("ranks only wallets meeting the minimum matched sells and active days", () => {
  const trades: PerformanceTrade[] = [];
  for (let index = 0; index < 10; index++) {
    const day = index < 4 ? "01" : index < 7 ? "02" : "03";
    trades.push(makeTrade("WalletGood", `Mint${index % 3}`, "buy", "100", `buy-${index}`, `2026-01-${day}T00:00:00.000Z`));
    trades.push(makeTrade("WalletGood", `Mint${index % 3}`, "sell", "120", `sell-${index}`, `2026-01-${day}T01:00:00.000Z`));
  }
  trades.push(makeTrade("WalletNew", "MintNew", "buy", "100", "new-buy", "2026-01-01T00:00:00.000Z"));
  trades.push(makeTrade("WalletNew", "MintNew", "sell", "150", "new-sell", "2026-01-01T01:00:00.000Z"));

  const rankings = rankWallets(calculateWalletPerformance(trades));
  const good = rankings.find((item) => item.wallet === "WalletGood");
  const fresh = rankings.find((item) => item.wallet === "WalletNew");

  assert.ok(good);
  assert.equal(good.eligible, true);
  assert.equal(good.rank, 1);
  assert.equal(good.matchedSellCount, 10);
  assert.equal(good.winRatePercent, 100);
  assert.equal(good.realizedPnlRaw, "200");
  assert.equal(good.activeDays, 3);
  assert.equal(good.positiveDayRatePercent, 100);
  assert.ok(fresh);
  assert.equal(fresh.eligible, false);
  assert.equal(fresh.rank, null);
  assert.equal(fresh.status, "insufficient_sample");
});

test("keeps rankings separate for different quote assets", () => {
  const performances = calculateWalletPerformance([
    makeTrade("WalletA", "MintA", "buy", "100", "a-buy", "2026-01-01T00:00:00.000Z", wsol),
    makeTrade("WalletA", "MintA", "sell", "200", "a-sell", "2026-01-02T00:00:00.000Z", wsol),
    makeTrade("WalletA", "MintB", "buy", "100", "b-buy", "2026-01-01T00:00:00.000Z", usdc),
    makeTrade("WalletA", "MintB", "sell", "200", "b-sell", "2026-01-02T00:00:00.000Z", usdc),
  ]);
  const rankings = rankWallets(performances);
  assert.equal(rankings.length, 2);
  assert.deepEqual(new Set(rankings.map((item) => item.quoteMint)), new Set([wsol, usdc]));
});

test("calculates profit factor and win rate from matched sells", () => {
  const performances = calculateWalletPerformance([
    makeTrade("WalletA", "MintA", "buy", "100", "buy-1", "2026-01-01T00:00:00.000Z"),
    makeTrade("WalletA", "MintA", "sell", "150", "sell-1", "2026-01-02T00:00:00.000Z"),
    makeTrade("WalletA", "MintA", "buy", "100", "buy-2", "2026-01-03T00:00:00.000Z"),
    makeTrade("WalletA", "MintA", "sell", "50", "sell-2", "2026-01-04T00:00:00.000Z"),
  ]);
  const [ranking] = rankWallets(performances, { minMatchedSells: 1, minActiveDays: 1 });
  assert.ok(ranking);
  assert.equal(ranking.profitableSellCount, 1);
  assert.equal(ranking.losingSellCount, 1);
  assert.equal(ranking.winRatePercent, 50);
  assert.equal(ranking.grossProfitRaw, "50");
  assert.equal(ranking.grossLossRaw, "50");
  assert.equal(ranking.profitFactor, "1.00");
});

test("excludes estimated timestamps from active-day regularity", () => {
  const trades: PerformanceTrade[] = [
    makeTrade("WalletA", "MintA", "buy", "100", "buy-1", "2026-01-01T00:00:00.000Z"),
    makeTrade("WalletA", "MintA", "sell", "150", "sell-1", "2026-01-01T01:00:00.000Z", wsol),
    makeTrade("WalletA", "MintA", "buy", "100", "buy-2", "2026-01-02T00:00:00.000Z"),
    { ...makeTrade("WalletA", "MintA", "sell", "150", "sell-2", "2026-01-02T01:00:00.000Z"), timestampIsEstimated: true },
  ];
  const [ranking] = rankWallets(calculateWalletPerformance(trades), { minMatchedSells: 1, minActiveDays: 1 });
  assert.ok(ranking);
  assert.equal(ranking.activeDays, 1);
});
