import type { WalletRanking } from "./wallet-ranking.js";

export interface WalletSelectionOptions {
  minReliabilityScore?: number;
  maxWallets?: number;
  minClosedTrades14d?: number;
  minMedianHoldingSeconds?: number;
  maxProfitConcentrationPercent?: number;
  maxDrawdownToGrossProfitPercent?: number;
}

/**
 * Selects profitable wallets with enough recent, repeatable and copyable
 * performance. Missing metrics fail closed: unknown holding time is not
 * treated as copyable.
 */
export function selectWalletsForPaperTrading(
  rankings: readonly WalletRanking[],
  options: WalletSelectionOptions = {},
): WalletRanking[] {
  const minReliabilityScore = options.minReliabilityScore ?? 65;
  const maxWallets = options.maxWallets ?? 10;
  const minClosedTrades14d = options.minClosedTrades14d ?? 30;
  const minMedianHoldingSeconds = options.minMedianHoldingSeconds ?? 10;
  const maxProfitConcentrationPercent = options.maxProfitConcentrationPercent ?? 50;
  const maxDrawdownToGrossProfitPercent = options.maxDrawdownToGrossProfitPercent ?? 50;

  if (!Number.isFinite(minReliabilityScore) || minReliabilityScore < 0 || minReliabilityScore > 100) {
    throw new Error("minReliabilityScore must be between 0 and 100");
  }
  if (!Number.isSafeInteger(maxWallets) || maxWallets < 1) {
    throw new Error("maxWallets must be a positive safe integer");
  }
  if (!Number.isSafeInteger(minClosedTrades14d) || minClosedTrades14d < 1) {
    throw new Error("minClosedTrades14d must be a positive safe integer");
  }
  if (!Number.isFinite(minMedianHoldingSeconds) || minMedianHoldingSeconds < 0) {
    throw new Error("minMedianHoldingSeconds must be non-negative");
  }
  if (!Number.isFinite(maxProfitConcentrationPercent) ||
      maxProfitConcentrationPercent < 0 || maxProfitConcentrationPercent > 100) {
    throw new Error("maxProfitConcentrationPercent must be between 0 and 100");
  }
  if (!Number.isFinite(maxDrawdownToGrossProfitPercent) ||
      maxDrawdownToGrossProfitPercent < 0 || maxDrawdownToGrossProfitPercent > 100) {
    throw new Error("maxDrawdownToGrossProfitPercent must be between 0 and 100");
  }

  return rankings
    .filter((item) => {
      if (
        !item.eligible ||
        item.status !== "positive_history" ||
        item.reliabilityScore === null ||
        item.reliabilityScore < minReliabilityScore ||
        item.closedTradeCount14d < minClosedTrades14d ||
        item.medianTradePnlRaw === null ||
        BigInt(item.medianTradePnlRaw) <= 0n ||
        item.medianHoldingSeconds === null ||
        item.medianHoldingSeconds < minMedianHoldingSeconds ||
        item.maxProfitConcentrationPercent > maxProfitConcentrationPercent
      ) return false;

      const grossProfit = BigInt(item.grossProfitRaw);
      const maxDrawdown = BigInt(item.maxDrawdownRaw);
      if (grossProfit <= 0n) return false;
      // Compare with integer arithmetic to avoid floating-point rounding.
      return maxDrawdown * 100n <= grossProfit * BigInt(Math.round(maxDrawdownToGrossProfitPercent));
    })
    .slice(0, maxWallets);
}

export function walletSelectionKey(wallet: string, quoteMint: string): string {
  return JSON.stringify([wallet, quoteMint]);
}
