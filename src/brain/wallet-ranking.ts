import type { WalletPerformance } from "./wallet-performance.js";

export interface WalletRankingOptions {
  minMatchedSells?: number;
  minActiveDays?: number;
}

export interface WalletRanking {
  wallet: string;
  quoteMint: string;
  quoteDecimals: number;
  rank: number | null;
  /** 0–100 heuristic score; null until the minimum sample is reached. */
  reliabilityScore: number | null;
  eligible: boolean;
  status: "insufficient_sample" | "positive_history" | "negative_history" | "breakeven";
  matchedSellCount: number;
  profitableSellCount: number;
  losingSellCount: number;
  winRatePercent: number;
  realizedPnlRaw: string;
  grossProfitRaw: string;
  grossLossRaw: string;
  profitFactor: string | null;
  matchedMintCount: number;
  activeDays: number;
  profitableDays: number;
  losingDays: number;
  positiveDayRatePercent: number;
  openPositionCount: number;
  pnlIsGross: true;
}

interface MutableRanking {
  wallet: string;
  quoteMint: string;
  quoteDecimals: number;
  matchedSellCount: number;
  profitableSellCount: number;
  losingSellCount: number;
  realizedPnl: bigint;
  grossProfit: bigint;
  grossLoss: bigint;
  mints: Set<string>;
  dailyPnl: Map<string, bigint>;
  openMints: Set<string>;
}

/**
 * Aggregates per-token FIFO results into comparable wallet groups.
 * Quote assets are deliberately kept separate: raw SOL and USDC units
 * must never be added together or compared as if they were the same currency.
 */
export function rankWallets(
  performances: readonly WalletPerformance[],
  options: WalletRankingOptions = {},
): WalletRanking[] {
  const minMatchedSells = options.minMatchedSells ?? 10;
  const minActiveDays = options.minActiveDays ?? 3;
  if (!Number.isSafeInteger(minMatchedSells) || minMatchedSells < 1) {
    throw new Error("minMatchedSells must be a positive safe integer");
  }
  if (!Number.isSafeInteger(minActiveDays) || minActiveDays < 1) {
    throw new Error("minActiveDays must be a positive safe integer");
  }

  const groups = new Map<string, MutableRanking>();
  for (const performance of performances) {
    const key = JSON.stringify([performance.wallet, performance.quoteMint]);
    let group = groups.get(key);
    if (!group) {
      group = {
        wallet: performance.wallet,
        quoteMint: performance.quoteMint,
        quoteDecimals: performance.quoteDecimals,
        matchedSellCount: 0,
        profitableSellCount: 0,
        losingSellCount: 0,
        realizedPnl: 0n,
        grossProfit: 0n,
        grossLoss: 0n,
        mints: new Set(),
        dailyPnl: new Map(),
        openMints: new Set(),
      };
      groups.set(key, group);
    }

    group.matchedSellCount += performance.matchedSellCount;
    group.profitableSellCount += performance.profitableSellCount;
    group.losingSellCount += performance.losingSellCount;
    group.realizedPnl += BigInt(performance.realizedPnlRaw);
    group.grossProfit += BigInt(performance.grossProfitRaw);
    group.grossLoss += BigInt(performance.grossLossRaw);
    if (performance.matchedSellCount > 0) group.mints.add(performance.mint);
    if (BigInt(performance.openTokenRaw) > 0n) group.openMints.add(performance.mint);

    for (const [day, rawPnl] of Object.entries(performance.dailyRealizedPnlRaw)) {
      group.dailyPnl.set(day, (group.dailyPnl.get(day) ?? 0n) + BigInt(rawPnl));
    }
  }

  const ranked = [...groups.values()].map((group) => {
    const activeDays = group.dailyPnl.size;
    const profitableDays = [...group.dailyPnl.values()].filter((pnl) => pnl > 0n).length;
    const losingDays = [...group.dailyPnl.values()].filter((pnl) => pnl < 0n).length;
    const eligible = group.matchedSellCount >= minMatchedSells && activeDays >= minActiveDays;
    const winRatePercent = group.matchedSellCount === 0
      ? 0
      : Number((BigInt(group.profitableSellCount) * 10_000n) / BigInt(group.matchedSellCount)) / 100;
    const positiveDayRatePercent = activeDays === 0
      ? 0
      : Number((BigInt(profitableDays) * 10_000n) / BigInt(activeDays)) / 100;
    const profitFactor = group.grossLoss === 0n
      ? (group.grossProfit > 0n ? "∞" : null)
      : (Number((group.grossProfit * 100n) / group.grossLoss) / 100).toFixed(2);
    const status = !eligible
      ? "insufficient_sample" as const
      : group.realizedPnl > 0n
        ? "positive_history" as const
        : group.realizedPnl < 0n
          ? "negative_history" as const
          : "breakeven" as const;

    return {
      wallet: group.wallet,
      quoteMint: group.quoteMint,
      quoteDecimals: group.quoteDecimals,
      rank: null as number | null,
      reliabilityScore: eligible
        ? Math.round((
            (Math.min(group.matchedSellCount / 30, 1) * 15) +
            (winRatePercent * 0.25) +
            (positiveDayRatePercent * 0.25) +
            ((profitFactor === "∞" ? 100 : profitFactor === null ? 0 : Math.min(Number(profitFactor) / 3, 1) * 100) * 0.20) +
            ((group.realizedPnl > 0n ? 100 : group.realizedPnl === 0n ? 50 : 0) * 0.15)
          ) * 100) / 100
        : null,
      eligible,
      status,
      matchedSellCount: group.matchedSellCount,
      profitableSellCount: group.profitableSellCount,
      losingSellCount: group.losingSellCount,
      winRatePercent,
      realizedPnlRaw: group.realizedPnl.toString(),
      grossProfitRaw: group.grossProfit.toString(),
      grossLossRaw: group.grossLoss.toString(),
      profitFactor,
      matchedMintCount: group.mints.size,
      activeDays,
      profitableDays,
      losingDays,
      positiveDayRatePercent,
      openPositionCount: group.openMints.size,
      pnlIsGross: true as const,
    };
  });

  ranked.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    const scoreA = a.reliabilityScore ?? -1;
    const scoreB = b.reliabilityScore ?? -1;
    if (scoreA !== scoreB) return scoreB - scoreA;
    const pnlA = BigInt(a.realizedPnlRaw);
    const pnlB = BigInt(b.realizedPnlRaw);
    if (pnlA !== pnlB) return pnlA > pnlB ? -1 : 1;
    return b.winRatePercent - a.winRatePercent;
  });

  let rank = 0;
  for (const item of ranked) {
    if (item.eligible) item.rank = ++rank;
  }
  return ranked;
}
