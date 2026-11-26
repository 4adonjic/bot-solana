import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PerformanceTrade } from "./wallet-performance.js";

export interface WalletTradeObservation extends PerformanceTrade {
  slot: number;
  tokenDecimals: number;
  dexProgramId?: string;
}

export interface WalletTradeStoreOptions {
  filePath?: string;
  maxTrades?: number;
}

const DEFAULT_FILE_PATH = "data/wallet-trades.jsonl";

/**
 * Append-only JSONL history. The in-memory index is rebuilt from disk at init.
 * Records are never silently evicted: when maxTrades is reached, record()
 * rejects new entries so the caller can log the data-loss risk explicitly.
 */
export class WalletTradeStore {
  private readonly filePath: string;
  private readonly maxTrades: number;
  private readonly trades: WalletTradeObservation[] = [];
  private readonly keys = new Set<string>();
  private writeQueue: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(options: WalletTradeStoreOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_FILE_PATH;
    this.maxTrades = options.maxTrades ?? 100_000;
    if (!Number.isSafeInteger(this.maxTrades) || this.maxTrades < 1) {
      throw new Error("maxTrades must be a positive safe integer");
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await mkdir(dirname(this.filePath), { recursive: true });

    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.initialized = true;
        return;
      }
      throw error;
    }

    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSON in wallet trade history at line ${index + 1}`);
      }
      if (!this.isObservation(parsed)) {
        throw new Error(`Invalid wallet trade observation at line ${index + 1}`);
      }
      const key = this.keyOf(parsed);
      if (this.keys.has(key)) continue;
      if (this.trades.length >= this.maxTrades) {
        throw new Error(`Wallet trade history exceeds maxTrades (${this.maxTrades})`);
      }
      this.keys.add(key);
      this.trades.push(parsed);
    }

    this.initialized = true;
  }

  async record(observation: WalletTradeObservation): Promise<{ observation: WalletTradeObservation; inserted: boolean }> {
    this.assertInitialized();
    if (!this.isObservation(observation)) {
      throw new Error("Invalid wallet trade observation");
    }

    const key = this.keyOf(observation);
    const existing = this.trades.find((trade) => this.keyOf(trade) === key);
    if (existing) return { observation: existing, inserted: false };
    if (this.trades.length >= this.maxTrades) {
      throw new Error(`Wallet trade history is full (maxTrades: ${this.maxTrades})`);
    }

    const write = async () => {
      // Re-check inside the queue to prevent concurrent duplicate appends.
      const duplicate = this.trades.find((trade) => this.keyOf(trade) === key);
      if (duplicate) return duplicate;
      if (this.trades.length >= this.maxTrades) {
        throw new Error(`Wallet trade history is full (maxTrades: ${this.maxTrades})`);
      }
      await appendFile(this.filePath, `${JSON.stringify(observation)}\n`, "utf8");
      this.keys.add(key);
      this.trades.push(observation);
      return observation;
    };

    let inserted = false;
    const queued = this.writeQueue.then(write, write);
    this.writeQueue = queued.then(() => undefined, () => undefined);
    const stored = await queued;
    inserted = stored === observation;
    return { observation: stored, inserted };
  }

  list(): WalletTradeObservation[] {
    this.assertInitialized();
    return [...this.trades];
  }

  count(): number {
    this.assertInitialized();
    return this.trades.length;
  }

  private keyOf(trade: Pick<WalletTradeObservation, "wallet" | "signature" | "mint">): string {
    return JSON.stringify([trade.wallet, trade.signature, trade.mint]);
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error("WalletTradeStore.init() must be called first");
  }

  private isObservation(value: unknown): value is WalletTradeObservation {
    if (typeof value !== "object" || value === null) return false;
    const item = value as Partial<WalletTradeObservation>;
    return (
      typeof item.wallet === "string" && item.wallet.length > 0 &&
      typeof item.signature === "string" && item.signature.length > 0 &&
      typeof item.mint === "string" && item.mint.length > 0 &&
      (item.side === "buy" || item.side === "sell") &&
      typeof item.tokenAmountRaw === "string" && /^\d+$/.test(item.tokenAmountRaw) &&
      typeof item.observedAt === "string" && !Number.isNaN(Date.parse(item.observedAt)) &&
      Number.isSafeInteger(item.slot) && (item.slot ?? -1) >= 0 &&
      Number.isInteger(item.tokenDecimals) && (item.tokenDecimals ?? -1) >= 0 && (item.tokenDecimals ?? 19) <= 18 &&
      (item.quoteAmountRaw === undefined || (typeof item.quoteAmountRaw === "string" && /^\d+$/.test(item.quoteAmountRaw))) &&
      (item.quoteMint === undefined || (typeof item.quoteMint === "string" && item.quoteMint.length > 0)) &&
      (item.quoteDecimals === undefined || (Number.isInteger(item.quoteDecimals) && item.quoteDecimals >= 0 && item.quoteDecimals <= 18)) &&
      (item.quoteSource === undefined || item.quoteSource === "token_balance" || item.quoteSource === "native_balance_estimate") &&
      (item.quoteAmountIsEstimate === undefined || typeof item.quoteAmountIsEstimate === "boolean") &&
      (item.dexProgramId === undefined || typeof item.dexProgramId === "string")
    );
  }
}
