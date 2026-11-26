import type { WalletRanking } from "./wallet-ranking.js";

export interface WalletSelectionOptions {
  minReliabilityScore?: number;
  maxWallets?: number;
}

/**
 * Selects proven, profitable wallet/quote pairs for paper trading.
 * Negative, breakeven, and insufficient-sample histories are never selected.
 */
export function selectWalletsForPaperTrading(
  rankings: readonly WalletRanking[],
  options: WalletSelectionOptions = {},
): WalletRanking[] {
  const minReliabilityScore = options.minReliabilityScore ?? 65;
  const maxWallets = options.maxWallets ?? 10;

  if (!Number.isFinite(minReliabilityScore) || minReliabilityScore < 0 || minReliabilityScore > 100) {
    throw new Error("minReliabilityScore must be between 0 and 100");
  }
  if (!Number.isSafeInteger(maxWallets) || maxWallets < 1) {
    throw new Error("maxWallets must be a positive safe integer");
  }

  return rankings
    .filter((item) =>
      item.eligible &&
      item.status === "positive_history" &&
      item.reliabilityScore !== null &&
      item.reliabilityScore >= minReliabilityScore,
    )
    .slice(0, maxWallets);
}

export function walletSelectionKey(wallet: string, quoteMint: string): string {
  return JSON.stringify([wallet, quoteMint]);
}
