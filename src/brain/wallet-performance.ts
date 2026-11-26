export interface PerformanceTrade {
  wallet: string;
  signature: string;
  mint: string;
  side: "buy" | "sell";
  tokenAmountRaw: string;
  quoteAmountRaw?: string;
  quoteMint?: string;
  quoteDecimals?: number;
  quoteSource?: "token_balance" | "native_balance_estimate";
  quoteAmountIsEstimate?: boolean;
  observedAt: string;
}

export interface WalletPerformance {
  wallet: string;
  mint: string;
  quoteMint: string;
  quoteDecimals: number;
  buyCount: number;
  sellCount: number;
  matchedSellCount: number;
  ignoredTradeCount: number;
  boughtTokenRaw: string;
  soldTokenRaw: string;
  matchedSoldTokenRaw: string;
  unmatchedSoldTokenRaw: string;
  openTokenRaw: string;
  openCostBasisRaw: string;
  realizedPnlRaw: string;
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
  ignoredTradeCount: number;
  boughtToken: bigint;
  soldToken: bigint;
  matchedSoldToken: bigint;
  unmatchedSoldToken: bigint;
  realizedPnl: bigint;
  lots: Lot[];
}

/**
 * Calculates FIFO realized performance using only exact WSOL/USDC balance
 * movements. Estimated native-SOL amounts and incomplete observations are
 * excluded. Results are gross of network/priority fees.
 *
 * Input order is preserved: callers must provide observations chronologically.
 */
export function calculateWalletPerformance(
  observations: readonly PerformanceTrade[],
): WalletPerformance[] {
  const groups = new Map<string, MutablePerformance>();

  for (const trade of observations) {
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
    if (!group) {
      group = {
        wallet: trade.wallet,
        mint: trade.mint,
        quoteMint: trade.quoteMint,
        quoteDecimals: trade.quoteDecimals,
        buyCount: 0,
        sellCount: 0,
        matchedSellCount: 0,
        ignoredTradeCount: 0,
        boughtToken: 0n,
        soldToken: 0n,
        matchedSoldToken: 0n,
        unmatchedSoldToken: 0n,
        realizedPnl: 0n,
        lots: [],
      };
      groups.set(key, group);
    }

    if (group.quoteDecimals !== trade.quoteDecimals) {
      group.ignoredTradeCount++;
      continue;
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
      group.matchedSellCount++;
      group.matchedSoldToken += matchedQuantity;
      group.realizedPnl += matchedProceeds - matchedCost;
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
      ignoredTradeCount: group.ignoredTradeCount,
      boughtTokenRaw: group.boughtToken.toString(),
      soldTokenRaw: group.soldToken.toString(),
      matchedSoldTokenRaw: group.matchedSoldToken.toString(),
      unmatchedSoldTokenRaw: group.unmatchedSoldToken.toString(),
      openTokenRaw: openToken.toString(),
      openCostBasisRaw: openCost.toString(),
      realizedPnlRaw: group.realizedPnl.toString(),
      pnlIsGross: true,
    };
  });
}
