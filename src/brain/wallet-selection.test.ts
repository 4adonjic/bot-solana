import assert from "node:assert/strict";
import { test } from "node:test";
import type { WalletRanking } from "./wallet-ranking.js";
import { selectWalletsForPaperTrading, walletSelectionKey } from "./wallet-selection.js";

function ranking(
  wallet: string,
  score: number | null,
  status: WalletRanking["status"] = "positive_history",
  eligible = true,
): WalletRanking {
  return {
    wallet,
    quoteMint: "QuoteMint",
    quoteDecimals: 6,
    rank: eligible ? 1 : null,
    reliabilityScore: score,
    eligible,
    status,
    matchedSellCount: eligible ? 10 : 2,
    profitableSellCount: 8,
    losingSellCount: 2,
    winRatePercent: 80,
    realizedPnlRaw: "100",
    grossProfitRaw: "120",
    grossLossRaw: "20",
    profitFactor: "6.00",
    matchedMintCount: 3,
    activeDays: eligible ? 3 : 1,
    profitableDays: 3,
    losingDays: 0,
    positiveDayRatePercent: 100,
    openPositionCount: 0,
    closedTradeCount14d: 35,
    realizedPnl14dRaw: "100",
    medianTradePnlRaw: "10",
    medianHoldingSeconds: 300,
    maxProfitConcentrationPercent: 25,
    maxDrawdownRaw: "20",
    pnlIsGross: true,
  };
}

test("selects only eligible profitable wallets above the score threshold", () => {
  const selected = selectWalletsForPaperTrading([
    ranking("Top", 91),
    ranking("BelowThreshold", 64),
    ranking("Negative", 99, "negative_history"),
    ranking("Breakeven", 99, "breakeven"),
    ranking("Insufficient", null, "insufficient_sample", false),
  ]);

  assert.deepEqual(selected.map((item) => item.wallet), ["Top"]);
});

test("keeps the highest-ranked wallets up to the configured limit", () => {
  const selected = selectWalletsForPaperTrading([
    ranking("First", 95),
    ranking("Second", 88),
    ranking("Third", 77),
  ], { minReliabilityScore: 70, maxWallets: 2 });

  assert.deepEqual(selected.map((item) => item.wallet), ["First", "Second"]);
});

test("validates selection limits", () => {
  assert.throws(() => selectWalletsForPaperTrading([], { minReliabilityScore: 101 }));
  assert.throws(() => selectWalletsForPaperTrading([], { maxWallets: 0 }));
});

test("selection keys distinguish quote assets for the same wallet", () => {
  assert.notEqual(walletSelectionKey("WalletA", "SOL"), walletSelectionKey("WalletA", "USDC"));
});


test("rejects wallets without enough recent trades or copyable holding times", () => {
  const good = ranking("Good", 90);
  assert.deepEqual(selectWalletsForPaperTrading([good]).map((item) => item.wallet), ["Good"]);
  assert.deepEqual(selectWalletsForPaperTrading([{ ...good, closedTradeCount14d: 29 }]), []);
  assert.deepEqual(selectWalletsForPaperTrading([{ ...good, medianHoldingSeconds: 9 }]), []);
  assert.deepEqual(selectWalletsForPaperTrading([{ ...good, medianHoldingSeconds: null }]), []);
});

test("rejects concentrated profits, non-positive median trades and excessive drawdown", () => {
  const good = ranking("Good", 90);
  assert.deepEqual(selectWalletsForPaperTrading([{ ...good, maxProfitConcentrationPercent: 50.01 }]), []);
  assert.deepEqual(selectWalletsForPaperTrading([{ ...good, medianTradePnlRaw: "0" }]), []);
  assert.deepEqual(selectWalletsForPaperTrading([{ ...good, maxDrawdownRaw: "61" }]), []);
  assert.deepEqual(selectWalletsForPaperTrading([{ ...good, grossProfitRaw: "0" }]), []);
});

test("validates copyability thresholds", () => {
  assert.throws(() => selectWalletsForPaperTrading([], { minClosedTrades14d: 0 }));
  assert.throws(() => selectWalletsForPaperTrading([], { minMedianHoldingSeconds: -1 }));
  assert.throws(() => selectWalletsForPaperTrading([], { maxProfitConcentrationPercent: 101 }));
  assert.throws(() => selectWalletsForPaperTrading([], { maxDrawdownToGrossProfitPercent: 101 }));
});
