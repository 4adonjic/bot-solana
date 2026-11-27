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

test("calculates rolling copyability metrics from reliable FIFO closed trades", () => {
  const trades: PerformanceTrade[] = [
    makeTrade("WalletCopyable", "MintA", "buy", "100", "b1", "2026-11-20T10:00:00.000Z"),
    makeTrade("WalletCopyable", "MintA", "sell", "200", "s1", "2026-11-20T10:01:00.000Z"),
    makeTrade("WalletCopyable", "MintA", "buy", "100", "b2", "2026-11-21T10:00:00.000Z"),
    makeTrade("WalletCopyable", "MintA", "sell", "50", "s2", "2026-11-21T10:02:00.000Z"),
    makeTrade("WalletCopyable", "MintA", "buy", "100", "b3", "2026-11-22T10:00:00.000Z"),
    makeTrade("WalletCopyable", "MintA", "sell", "120", "s3", "2026-11-22T10:05:00.000Z"),
  ];
  const [ranking] = rankWallets(calculateWalletPerformance(trades), {
    minMatchedSells: 1,
    minActiveDays: 1,
    now: new Date("2026-11-27T12:00:00.000Z"),
  });

  assert.ok(ranking);
  assert.equal(ranking.closedTradeCount14d, 3);
  assert.equal(ranking.realizedPnl14dRaw, "70");
  assert.equal(ranking.medianTradePnlRaw, "20");
  assert.equal(ranking.medianHoldingSeconds, 120);
  assert.equal(ranking.maxProfitConcentrationPercent, 83.33);
  assert.equal(ranking.maxDrawdownRaw, "50");
});

test("excludes estimated timestamps from rolling trade count and holding duration", () => {
  const trades: PerformanceTrade[] = [
    makeTrade("WalletEstimated", "MintA", "buy", "100", "b1", "2026-11-20T10:00:00.000Z"),
    { ...makeTrade("WalletEstimated", "MintA", "sell", "150", "s1", "2026-11-20T10:01:00.000Z"), timestampIsEstimated: true },
  ];
  const [ranking] = rankWallets(calculateWalletPerformance(trades), {
    minMatchedSells: 1,
    minActiveDays: 1,
    now: new Date("2026-11-27T12:00:00.000Z"),
  });

  assert.ok(ranking);
  assert.equal(ranking.closedTradeCount14d, 0);
  assert.equal(ranking.medianHoldingSeconds, null);
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


test("computes provisional bounded reliability scores for insufficient samples", () => {
  const trades: PerformanceTrade[] = [];
  for (let index = 0; index < 10; index++) {
    const day = index < 4 ? "01" : index < 7 ? "02" : "03";
    trades.push(makeTrade("WalletScored", `Mint${index % 2}`, "buy", "100", `score-buy-${index}`, `2026-02-${day}T00:00:00.000Z`));
    trades.push(makeTrade("WalletScored", `Mint${index % 2}`, "sell", index < 8 ? "120" : "80", `score-sell-${index}`, `2026-02-${day}T01:00:00.000Z`));
  }
  trades.push(makeTrade("WalletTooNew", "MintNew", "buy", "100", "tiny-buy", "2026-02-01T00:00:00.000Z"));
  trades.push(makeTrade("WalletTooNew", "MintNew", "sell", "150", "tiny-sell", "2026-02-01T01:00:00.000Z"));

  const rankings = rankWallets(calculateWalletPerformance(trades));
  const scored = rankings.find((item) => item.wallet === "WalletScored");
  const tooNew = rankings.find((item) => item.wallet === "WalletTooNew");

  assert.ok(scored);
  assert.equal(scored.eligible, true);
  assert.ok(scored.reliabilityScore !== null);
  assert.ok(scored.reliabilityScore >= 0 && scored.reliabilityScore <= 100);
  assert.ok(tooNew);
  assert.ok(tooNew.reliabilityScore !== null);
  assert.ok(tooNew.reliabilityScore >= 0 && tooNew.reliabilityScore <= 100);
  assert.equal(tooNew.status, "insufficient_sample");
});
