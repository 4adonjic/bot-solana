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
}
export interface Snapshot {
  generatedAt: string;
  dataDirectory: string;
  sources: { candidates: boolean; trades: boolean; watchlist: boolean; paper: boolean };
  counts: {
    candidates: number; observedTrades: number; trackedWallets: number;
    activeWallets: number; paperFills: number; openPositions: number;
  };
  candidates: Candidate[];
  watchlist: WatchEntry[];
  trades: Array<{ wallet: string; signature: string; mint: string; side: "buy" | "sell"; observedAt: string }>;
  paper: null | { balances: Record<string, string>; positions: PaperPosition[]; fills: PaperFill[] };
}
declare global {
  interface Window {
    botDashboard?: { getSnapshot: () => Promise<Snapshot> };
  }
}
