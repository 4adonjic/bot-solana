import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PerformanceTrade } from "./wallet-performance.js";

export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export interface PaperQuoteAsset {
  mint: string;
  decimals: number;
  initialBalanceRaw: string;
  buySizeRaw: string;
}

export type PaperQuoteProvider = (inputMint: string, outputMint: string, amountRaw: string) => Promise<{ outAmountRaw: string } | null>;

export interface PaperTradingOptions {
  filePath?: string;
  quoteAssets?: readonly PaperQuoteAsset[];
  slippageBps?: number;
  minSlippageBps?: number;
  maxSlippageBps?: number;
  copyDelayMs?: number;
  quoteProvider?: PaperQuoteProvider;
  feeBps?: number;
  maxFills?: number;
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

export interface PaperTradingSnapshot {
  version: 1;
  balances: Record<string, string>;
  positions: PaperPosition[];
  fills: PaperFill[];
}

export type PaperTradeResult =
  | { executed: true; fill: PaperFill; balanceRaw: string; position: PaperPosition | null }
  | { executed: false; reason: string };

const DEFAULT_FILE_PATH = "data/paper-trading.json";
const DEFAULT_ASSETS: readonly PaperQuoteAsset[] = [
  { mint: WSOL_MINT, decimals: 9, initialBalanceRaw: "1000000000", buySizeRaw: "50000000" },
  { mint: USDC_MINT, decimals: 6, initialBalanceRaw: "100000000", buySizeRaw: "5000000" },
];

/**
 * Local paper portfolio. It never creates, signs, or submits Solana transactions.
 * Entries use a fixed quote budget. Sells copy the leader position fraction using
 * transaction-visible pre/post token balances; ambiguous sells are rejected.
 * Source quote movements must be exact token deltas. Prices remain a source-price proxy.
 */
export class PaperTradingEngine {
  private readonly filePath: string;
  private readonly assets: Map<string, PaperQuoteAsset>;
  private readonly slippageBps: number;
  private readonly minSlippageBps: number;
  private readonly maxSlippageBps: number;
  private readonly copyDelayMs: number;
  private readonly quoteProvider: PaperQuoteProvider | undefined;
  private readonly feeBps: number;
  private readonly maxFills: number;
  private state: PaperTradingSnapshot;
  private initialized = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: PaperTradingOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_FILE_PATH;
    const assets = options.quoteAssets ?? DEFAULT_ASSETS;
    this.assets = new Map(assets.map((asset) => [asset.mint, asset]));
    this.slippageBps = options.slippageBps ?? 50;
    this.minSlippageBps = options.minSlippageBps ?? this.slippageBps;
    this.maxSlippageBps = options.maxSlippageBps ?? this.slippageBps;
    this.copyDelayMs = options.copyDelayMs ?? (options.quoteProvider ? 3_000 : 0);
    this.quoteProvider = options.quoteProvider;
    this.feeBps = options.feeBps ?? 10;
    this.maxFills = options.maxFills ?? 100_000;

    if (this.assets.size !== assets.length || this.assets.size === 0) {
      throw new Error("Paper quote assets must be non-empty and unique");
    }
    for (const asset of assets) {
      if (
        !asset.mint ||
        !Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 18 ||
        !/^\d+$/.test(asset.initialBalanceRaw) ||
        !/^\d+$/.test(asset.buySizeRaw) ||
        BigInt(asset.initialBalanceRaw) <= 0n ||
        BigInt(asset.buySizeRaw) <= 0n
      ) {
        throw new Error("Invalid paper quote asset configuration");
      }
    }
    if (!Number.isInteger(this.slippageBps) || this.slippageBps < 0 || this.slippageBps >= 10_000) {
      throw new Error("slippageBps must be between 0 and 9999");
    }
    if (!Number.isInteger(this.minSlippageBps) || this.minSlippageBps < 0 ||
        !Number.isInteger(this.maxSlippageBps) || this.maxSlippageBps < this.minSlippageBps ||
        this.maxSlippageBps >= 10_000) {
      throw new Error("slippage range must be valid and below 10000 bps");
    }
    if (!Number.isSafeInteger(this.copyDelayMs) || this.copyDelayMs < 0 || this.copyDelayMs > 60_000) {
      throw new Error("copyDelayMs must be between 0 and 60000");
    }
    if (!Number.isInteger(this.feeBps) || this.feeBps < 0 || this.feeBps >= 10_000) {
      throw new Error("feeBps must be between 0 and 9999");
    }
    if (!Number.isSafeInteger(this.maxFills) || this.maxFills < 1) {
      throw new Error("maxFills must be a positive safe integer");
    }

    this.state = {
      version: 1,
      balances: Object.fromEntries(assets.map((asset) => [asset.mint, asset.initialBalanceRaw])),
      positions: [],
      fills: [],
    };
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.persist(this.state);
      this.initialized = true;
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("Invalid JSON in paper trading state");
    }
    if (!this.isSnapshot(parsed)) throw new Error("Invalid paper trading state");
    for (const asset of this.assets.values()) {
      if (parsed.balances[asset.mint] === undefined) {
        throw new Error(`Paper trading state is missing quote balance ${asset.mint}`);
      }
    }
    for (const position of parsed.positions) {
      if (!this.assets.has(position.quoteMint)) {
        throw new Error(`Paper position uses unsupported quote mint ${position.quoteMint}`);
      }
    }
    this.state = parsed;
    this.initialized = true;
  }

  async processTrade(trade: PerformanceTrade): Promise<PaperTradeResult> {
    this.assertInitialized();
    const queued = this.queue.then(() => this.applyTrade(trade));
    this.queue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  snapshot(): PaperTradingSnapshot {
    this.assertInitialized();
    return JSON.parse(JSON.stringify(this.state)) as PaperTradingSnapshot;
  }

  private async applyTrade(trade: PerformanceTrade): Promise<PaperTradeResult> {
    if (
      !trade.wallet || !trade.signature || !trade.mint ||
      !/^\d+$/.test(trade.tokenAmountRaw) || BigInt(trade.tokenAmountRaw) <= 0n ||
      !trade.quoteMint || trade.quoteDecimals === undefined ||
      (!this.quoteProvider && (
        !trade.quoteAmountRaw || !/^\d+$/.test(trade.quoteAmountRaw) || BigInt(trade.quoteAmountRaw) <= 0n ||
        trade.quoteSource !== "token_balance" || trade.quoteAmountIsEstimate !== false
      ))
    ) {
      return { executed: false, reason: this.quoteProvider ? "invalid_trade_data" : "missing_or_estimated_exact_quote_amount" };
    }

    const asset = this.assets.get(trade.quoteMint);
    if (!asset || asset.decimals !== trade.quoteDecimals) {
      return { executed: false, reason: "unsupported_quote_asset" };
    }
    if (this.state.fills.some((fill) => fill.wallet === trade.wallet && fill.sourceSignature === trade.signature && fill.mint === trade.mint)) {
      return { executed: false, reason: "duplicate_source_trade" };
    }
    if (this.state.fills.length >= this.maxFills) {
      return { executed: false, reason: "paper_fill_history_full" };
    }

    const balances = { ...this.state.balances };
    const positions = this.state.positions.map((position) => ({ ...position }));
    const positionIndex = positions.findIndex((position) =>
      position.wallet === trade.wallet && position.mint === trade.mint && position.quoteMint === trade.quoteMint,
    );
    const position = positionIndex >= 0 ? positions[positionIndex] : undefined;
    if (this.copyDelayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.copyDelayMs));
    }
    const slippageBps = this.chooseSlippage(trade.signature);
    const sourceTokens = BigInt(trade.tokenAmountRaw);
    const sourceQuote = trade.quoteAmountRaw && /^\d+$/.test(trade.quoteAmountRaw)
      ? BigInt(trade.quoteAmountRaw)
      : 0n;
    const currentBalance = BigInt(balances[asset.mint] ?? "0");
    let tokenAmount: bigint;
    let quoteAmount: bigint;
    let fee: bigint;
    let nextPosition: PaperPosition | null;

    if (trade.side === "buy") {
      const budget = BigInt(asset.buySizeRaw) < currentBalance ? BigInt(asset.buySizeRaw) : currentBalance;
      if (budget <= 0n) return { executed: false, reason: "insufficient_virtual_balance" };
      fee = (budget * BigInt(this.feeBps)) / 10_000n;
      const marketSpend = budget - fee;
      if (this.quoteProvider) {
        const quote = await this.quoteProvider(asset.mint, trade.mint, marketSpend.toString());
        if (!quote || !/^\d+$/.test(quote.outAmountRaw) || BigInt(quote.outAmountRaw) <= 0n) {
          return { executed: false, reason: "fresh_jupiter_quote_unavailable" };
        }
        tokenAmount = (BigInt(quote.outAmountRaw) * BigInt(10_000 - slippageBps)) / 10_000n;
      } else {
        tokenAmount = (marketSpend * sourceTokens * BigInt(10_000 - slippageBps)) / (sourceQuote * 10_000n);
      }
      if (tokenAmount <= 0n) return { executed: false, reason: "simulated_token_amount_rounds_to_zero" };
      quoteAmount = budget;
      balances[asset.mint] = (currentBalance - budget).toString();

      const updated: PaperPosition = {
        wallet: trade.wallet,
        mint: trade.mint,
        quoteMint: trade.quoteMint,
        tokenAmountRaw: ((position ? BigInt(position.tokenAmountRaw) : 0n) + tokenAmount).toString(),
        costBasisRaw: ((position ? BigInt(position.costBasisRaw) : 0n) + budget).toString(),
      };
      if (positionIndex >= 0) positions[positionIndex] = updated;
      else positions.push(updated);
      nextPosition = updated;
    } else {
      if (!position || BigInt(position.tokenAmountRaw) <= 0n) {
        return { executed: false, reason: "no_open_paper_position" };
      }
      if (
        trade.tokenBalanceBeforeRaw === undefined || trade.tokenBalanceAfterRaw === undefined ||
        !/^\d+$/.test(trade.tokenBalanceBeforeRaw) || !/^\d+$/.test(trade.tokenBalanceAfterRaw)
      ) {
        return { executed: false, reason: "missing_leader_position_balances_for_proportional_sell" };
      }
      const leaderBefore = BigInt(trade.tokenBalanceBeforeRaw);
      const leaderAfter = BigInt(trade.tokenBalanceAfterRaw);
      if (leaderBefore <= 0n || leaderAfter >= leaderBefore || leaderBefore - leaderAfter !== sourceTokens) {
        return { executed: false, reason: "inconsistent_leader_position_balances" };
      }
      const paperPositionTokens = BigInt(position.tokenAmountRaw);
      tokenAmount = (paperPositionTokens * sourceTokens) / leaderBefore;
      if (tokenAmount <= 0n) return { executed: false, reason: "proportional_sell_rounds_to_zero" };
      if (tokenAmount > paperPositionTokens) return { executed: false, reason: "proportional_sell_exceeds_paper_position" };
      let grossProceeds: bigint;
      if (this.quoteProvider) {
        const quote = await this.quoteProvider(trade.mint, asset.mint, tokenAmount.toString());
        if (!quote || !/^\d+$/.test(quote.outAmountRaw) || BigInt(quote.outAmountRaw) <= 0n) {
          return { executed: false, reason: "fresh_jupiter_quote_unavailable" };
        }
        grossProceeds = (BigInt(quote.outAmountRaw) * BigInt(10_000 - slippageBps)) / 10_000n;
      } else {
        grossProceeds = (tokenAmount * sourceQuote * BigInt(10_000 - slippageBps)) / (sourceTokens * 10_000n);
      }
      fee = (grossProceeds * BigInt(this.feeBps)) / 10_000n;
      quoteAmount = grossProceeds - fee;
      if (quoteAmount <= 0n) return { executed: false, reason: "simulated_proceeds_round_to_zero" };
      balances[asset.mint] = (currentBalance + quoteAmount).toString();
      const costConsumed = tokenAmount === paperPositionTokens
        ? BigInt(position.costBasisRaw)
        : (BigInt(position.costBasisRaw) * tokenAmount) / paperPositionTokens;
      const remainingTokens = paperPositionTokens - tokenAmount;
      if (remainingTokens === 0n) {
        positions.splice(positionIndex, 1);
        nextPosition = null;
      } else {
        const updated: PaperPosition = {
          ...position,
          tokenAmountRaw: remainingTokens.toString(),
          costBasisRaw: (BigInt(position.costBasisRaw) - costConsumed).toString(),
        };
        positions[positionIndex] = updated;
        nextPosition = updated;
      }
    }

    const fill: PaperFill = {
      wallet: trade.wallet,
      sourceSignature: trade.signature,
      mint: trade.mint,
      side: trade.side,
      quoteMint: trade.quoteMint,
      quoteDecimals: trade.quoteDecimals,
      tokenAmountRaw: tokenAmount.toString(),
      quoteAmountRaw: quoteAmount.toString(),
      feeQuoteRaw: fee.toString(),
      slippageBps,
      observedAt: trade.observedAt,
    };
    const nextState: PaperTradingSnapshot = {
      version: 1,
      balances,
      positions,
      fills: [...this.state.fills, fill],
    };
    await this.persist(nextState);
    this.state = nextState;
    return {
      executed: true,
      fill,
      balanceRaw: balances[asset.mint] ?? "0",
      position: nextPosition,
    };
  }

  private chooseSlippage(signature: string): number {
    if (this.minSlippageBps === this.maxSlippageBps) return this.minSlippageBps;
    let hash = 0;
    for (let index = 0; index < signature.length; index++) {
      hash = (Math.imul(hash, 31) + signature.charCodeAt(index)) >>> 0;
    }
    return this.minSlippageBps + (hash % (this.maxSlippageBps - this.minSlippageBps + 1));
  }

  private async persist(snapshot: PaperTradingSnapshot): Promise<void> {
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.filePath);
  }

  private isSnapshot(value: unknown): value is PaperTradingSnapshot {
    if (typeof value !== "object" || value === null) return false;
    const item = value as Partial<PaperTradingSnapshot>;
    if (item.version !== 1 || typeof item.balances !== "object" || item.balances === null) return false;
    if (!Array.isArray(item.positions) || !Array.isArray(item.fills)) return false;
    if (!Object.values(item.balances).every((balance) => typeof balance === "string" && /^\d+$/.test(balance))) return false;
    if (!item.positions.every((position) =>
      typeof position.wallet === "string" && typeof position.mint === "string" &&
      typeof position.quoteMint === "string" && typeof position.tokenAmountRaw === "string" &&
      /^\d+$/.test(position.tokenAmountRaw) && typeof position.costBasisRaw === "string" &&
      /^\d+$/.test(position.costBasisRaw),
    )) return false;
    return item.fills.every((fill) =>
      typeof fill.wallet === "string" && typeof fill.sourceSignature === "string" &&
      typeof fill.mint === "string" && (fill.side === "buy" || fill.side === "sell") &&
      typeof fill.quoteMint === "string" && Number.isInteger(fill.quoteDecimals) &&
      typeof fill.tokenAmountRaw === "string" && /^\d+$/.test(fill.tokenAmountRaw) &&
      typeof fill.quoteAmountRaw === "string" && /^\d+$/.test(fill.quoteAmountRaw) &&
      typeof fill.feeQuoteRaw === "string" && /^\d+$/.test(fill.feeQuoteRaw) &&
      Number.isInteger(fill.slippageBps) && typeof fill.observedAt === "string",
    );
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error("PaperTradingEngine.init() must be called first");
  }
}

export const DEFAULT_PAPER_TRADING_ASSETS = DEFAULT_ASSETS;
