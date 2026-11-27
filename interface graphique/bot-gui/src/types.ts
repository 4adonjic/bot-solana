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
  wallet: string;
  quoteMint: string;
  quoteDecimals: number;
  rank: number | null;
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
  closedTradeCount14d: number;
  realizedPnl14dRaw: string;
  medianTradePnlRaw: string | null;
  medianHoldingSeconds: number | null;
  maxProfitConcentrationPercent: number;
  maxDrawdownRaw: string;
  pnlIsGross: true;
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
  paper: null | { balances: Record<string, string>; positions: PaperPosition[]; performance: Record<string, { realizedPnlRaw: string; totalFeesRaw: string; closedTrades: number; wins: number; losses: number; slippageBpsTotal: number; slippageSamples: number; averageSlippageBps: number | null }>; walletPerformance: Array<{ wallet: string; quoteMint: string; realizedPnlRaw: string; totalFeesRaw: string; buys: number; sells: number; closedTrades: number; wins: number; losses: number; slippageBpsTotal: number; slippageSamples: number; averageSlippageBps: number | null }>; fills: PaperFill[] };
}
export interface DesktopSettings {
  rpcHttpUrl: string;
  rpcWsUrl: string;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  targetWallets: string;
  enableDexDiscovery: boolean;
  enablePaperTrading: boolean;
  configured: boolean;
}
export interface BotStatus {
  state: "stopped" | "starting" | "running" | "stopping";
  pid: number | null;
  startedAt: string | null;
  exitCode: number | null;
  message: string;
}
export interface BotLogEntry {
  at: string;
  source: string;
  message: string;
}
declare global {
  interface Window {
    botDashboard?: {
      getSnapshot: () => Promise<Snapshot>;
      getSettings: () => Promise<DesktopSettings>;
      saveSettings: (settings: Omit<DesktopSettings, 'configured'>) => Promise<{ settings: DesktopSettings; restartRequired: boolean; botRunning: boolean }>;
      getManualWallets: () => Promise<{ observed: string[]; paper: string[] }>;
      addManualWallet: (input: { wallet: string; mode: 'observe' | 'paper' }) => Promise<{ mode: 'observe' | 'paper'; wallets: string[]; restartRequired: boolean }>;
      removeManualWallet: (input: { wallet: string; mode: 'observe' | 'paper' }) => Promise<{ mode: 'observe' | 'paper'; wallets: string[]; restartRequired: boolean }>;
      getBotStatus: () => Promise<BotStatus>;
      getBotLogs: () => Promise<BotLogEntry[]>;
      startBot: () => Promise<BotStatus>;
      stopBot: () => Promise<BotStatus>;
      onBotStatus: (callback: (status: BotStatus) => void) => () => void;
      onBotLog: (callback: (entry: BotLogEntry) => void) => () => void;
    };
  }
}
