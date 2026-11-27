export interface Candidate {
  wallet: string;
  firstSeenAt: string;
  lastSeenAt: string;
  observationCount: number;
}
export interface WatchEntry {
  wallet: string;
  quoteMint: string;
  reliabilityScore: number;
  firstSelectedAt: string;
  lastSelectedAt: string;
  selectionCount: number;
  active: boolean;
  scoreHistory: number[];
  trend: "improving" | "stable" | "declining";
}
export interface PaperPosition {
  wallet: string;
  mint: string;
  quoteMint: string;
  tokenAmountRaw: string;
  costBasisRaw: string;
}
export interface PaperFill {
  wallet: string;
  sourceSignature: string;
  mint: string;
  side: "buy" | "sell";
  quoteMint: string;
  quoteDecimals: number;
  tokenAmountRaw: string;
  quoteAmountRaw: string;
  feeQuoteRaw: string;
  slippageBps: number;
  observedAt: string;
  realizedPnlRaw?: string;
}
export interface WalletRanking {
  wallet: string; quoteMint: string; rank: number | null; reliabilityScore: number | null;
  eligible: boolean; status: "insufficient_sample" | "positive_history" | "negative_history" | "breakeven";
  matchedSellCount: number; activeDays: number; winRatePercent: number;
  realizedPnlRaw: string; profitFactor: string | null;
}
export interface Snapshot {
  generatedAt: string;
  dataDirectory: string;
  sources: { candidates: boolean; trades: boolean; watchlist: boolean; paper: boolean };
  counts: {
    candidates: number; evaluatedWallets: number; observedTrades: number; trackedWallets: number;
    activeWallets: number; paperFills: number; openPositions: number;
  };
  candidates: Candidate[];
  rankings: WalletRanking[];
  watchlist: WatchEntry[];
  trades: Array<{ wallet: string; signature: string; mint: string; side: "buy" | "sell"; observedAt: string }>;
  paper: null | { balances: Record<string, string>; positions: PaperPosition[]; performance: Record<string, { realizedPnlRaw: string; totalFeesRaw: string; closedTrades: number; wins: number; losses: number; slippageBpsTotal: number; slippageSamples: number; averageSlippageBps: number | null }>; fills: PaperFill[] };
}
declare global {
  interface Window {
    botDashboard?: { getSnapshot: () => Promise<Snapshot> };
  }
}
