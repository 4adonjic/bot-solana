export interface PerformanceTrade {
  wallet: string;
  signature: string;
  mint: string;
  side: "buy" | "sell";
  tokenAmountRaw: string;
  /** Transaction-metadata token balance before/after this trade; may omit untouched token accounts. */
  tokenBalanceBeforeRaw?: string;
  tokenBalanceAfterRaw?: string;
  quoteAmountRaw?: string;
  quoteMint?: string;
  quoteDecimals?: number;
  quoteSource?: "token_balance" | "native_balance_estimate";
  quoteAmountIsEstimate?: boolean;
  observedAt: string;
  /** Solana slot gives a reliable transaction ordering across callback arrival times. */
  slot?: number;
  /** True when observedAt is the local detection time, not the transaction blockTime. */
  timestampIsEstimated?: boolean;
}

export interface WalletPerformance {
  wallet: string;
  mint: string;
  quoteMint: string;
  quoteDecimals: number;
  buyCount: number;
  sellCount: number;
  matchedSellCount: number;
  profitableSellCount: number;
  losingSellCount: number;
  grossProfitRaw: string;
  grossLossRaw: string;
  boughtTokenRaw: string;
  soldTokenRaw: string;
  matchedSoldTokenRaw: string;
  unmatchedSoldTokenRaw: string;
  openTokenRaw: string;
  openCostBasisRaw: string;
  realizedPnlRaw: string;
  /** Daily realized PnL, keyed by UTC date; estimated timestamps are excluded. */
  dailyRealizedPnlRaw: Record<string, string>;
  /** Gross PnL before network fees, priority fees, and other transaction costs. */
  pnlIsGross: true;
}

interface Lot {
  quantity: bigint;
  cost: bigint;
}

interface MutablePerformance {
  wallet: string;
  mint: string;
  quoteMint: string;
  quoteDecimals: number;
  buyCount: number;
  sellCount: number;
  matchedSellCount: number;
  profitableSellCount: number;
  losingSellCount: number;
  grossProfit: bigint;
  grossLoss: bigint;
  boughtToken: bigint;
  soldToken: bigint;
  matchedSoldToken: bigint;
  unmatchedSoldToken: bigint;
  realizedPnl: bigint;
  dailyRealizedPnl: Map<string, bigint>;
  lots: Lot[];
}

/**
 * Calculates FIFO realized performance using only exact quote-token balance
 * movements. Estimated native-SOL amounts and incomplete observations are
 * excluded. Results are gross of network/priority fees.
 *
 * When slot metadata is available, observations are processed in slot order,
 * not WebSocket callback arrival order. Same-slot input order is preserved.
 */
export function calculateWalletPerformance(
  observations: readonly PerformanceTrade[],
): WalletPerformance[] {
  const ordered = observations.map((trade, index) => ({ trade, index })).sort((a, b) => {
    if (a.trade.slot !== undefined && b.trade.slot !== undefined) {
      return a.trade.slot - b.trade.slot || a.index - b.index;
    }
    return Date.parse(a.trade.observedAt) - Date.parse(b.trade.observedAt) || a.index - b.index;
  });

  const groups = new Map<string, MutablePerformance>();

  for (const { trade } of ordered) {
    if (
      !/^\d+$/.test(trade.tokenAmountRaw) ||
      !trade.quoteAmountRaw ||
      !/^\d+$/.test(trade.quoteAmountRaw) ||
      !trade.quoteMint ||
      trade.quoteDecimals === undefined ||
      !Number.isInteger(trade.quoteDecimals) ||
      trade.quoteDecimals < 0 ||
      trade.quoteDecimals > 18 ||
      trade.quoteSource !== "token_balance" ||
      trade.quoteAmountIsEstimate !== false
    ) {
      continue;
    }

    const quantity = BigInt(trade.tokenAmountRaw);
    const quoteAmount = BigInt(trade.quoteAmountRaw);
    if (quantity <= 0n || quoteAmount <= 0n) continue;

    const key = JSON.stringify([trade.wallet, trade.mint, trade.quoteMint]);
    let group = groups.get(key);
    if (group === undefined) {
      const created: MutablePerformance = {
        wallet: trade.wallet,
        mint: trade.mint,
        quoteMint: trade.quoteMint,
        quoteDecimals: trade.quoteDecimals,
        buyCount: 0,
        sellCount: 0,
        matchedSellCount: 0,
        profitableSellCount: 0,
        losingSellCount: 0,
        grossProfit: 0n,
        grossLoss: 0n,
        boughtToken: 0n,
        soldToken: 0n,
        matchedSoldToken: 0n,
        unmatchedSoldToken: 0n,
        realizedPnl: 0n,
        dailyRealizedPnl: new Map(),
        lots: [],
      };
      groups.set(key, created);
      group = created;
    }

    if (trade.side === "buy") {
      group.buyCount++;
      group.boughtToken += quantity;
      group.lots.push({ quantity, cost: quoteAmount });
      continue;
    }

    group.sellCount++;
    group.soldToken += quantity;

    let remainingToMatch = quantity;
    let matchedCost = 0n;
    for (const lot of group.lots) {
      if (remainingToMatch === 0n) break;
      if (lot.quantity === 0n) continue;

      const consumed = lot.quantity < remainingToMatch ? lot.quantity : remainingToMatch;
      const cost = consumed === lot.quantity
        ? lot.cost
        : (lot.cost * consumed) / lot.quantity;

      lot.quantity -= consumed;
      lot.cost -= cost;
      remainingToMatch -= consumed;
      matchedCost += cost;
    }

    const matchedQuantity = quantity - remainingToMatch;
    const matchedProceeds = matchedQuantity === quantity
      ? quoteAmount
      : (quoteAmount * matchedQuantity) / quantity;

    if (matchedQuantity > 0n) {
      const matchedPnl = matchedProceeds - matchedCost;
      group.matchedSellCount++;
      group.matchedSoldToken += matchedQuantity;
      group.realizedPnl += matchedPnl;
      if (matchedPnl > 0n) {
        group.profitableSellCount++;
        group.grossProfit += matchedPnl;
      }
      if (matchedPnl < 0n) {
        group.losingSellCount++;
        group.grossLoss += -matchedPnl;
      }

      if (trade.timestampIsEstimated !== true) {
        const timestamp = Date.parse(trade.observedAt);
        if (!Number.isNaN(timestamp)) {
          const day = new Date(timestamp).toISOString().slice(0, 10);
          group.dailyRealizedPnl.set(day, (group.dailyRealizedPnl.get(day) ?? 0n) + matchedPnl);
        }
      }
    }
    group.unmatchedSoldToken += remainingToMatch;
  }

  return [...groups.values()].map((group) => {
    const openToken = group.lots.reduce((sum, lot) => sum + lot.quantity, 0n);
    const openCost = group.lots.reduce((sum, lot) => sum + lot.cost, 0n);
    return {
      wallet: group.wallet,
      mint: group.mint,
      quoteMint: group.quoteMint,
      quoteDecimals: group.quoteDecimals,
      buyCount: group.buyCount,
      sellCount: group.sellCount,
      matchedSellCount: group.matchedSellCount,
      profitableSellCount: group.profitableSellCount,
      losingSellCount: group.losingSellCount,
      grossProfitRaw: group.grossProfit.toString(),
      grossLossRaw: group.grossLoss.toString(),
      boughtTokenRaw: group.boughtToken.toString(),
      soldTokenRaw: group.soldToken.toString(),
      matchedSoldTokenRaw: group.matchedSoldToken.toString(),
      unmatchedSoldTokenRaw: group.unmatchedSoldToken.toString(),
      openTokenRaw: openToken.toString(),
      openCostBasisRaw: openCost.toString(),
      realizedPnlRaw: group.realizedPnl.toString(),
      dailyRealizedPnlRaw: Object.fromEntries(
        [...group.dailyRealizedPnl.entries()].map(([day, pnl]) => [day, pnl.toString()]),
      ),
      pnlIsGross: true,
    };
  });
}
