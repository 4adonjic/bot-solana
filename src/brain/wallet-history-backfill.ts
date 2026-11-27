import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PublicKey, type Connection } from "@solana/web3.js";
import type { TransactionDecoder } from "../decoder/decoder.js";
import type { WalletCandidateStore } from "./wallet-candidate-store.js";
import type { WalletTradeStore } from "./wallet-trade-store.js";

interface BackfillState {
  version: 1;
  wallets: Record<string, { before?: string; scanned: number; complete: boolean }>;
}

export interface WalletHistoryBackfillOptions {
  connection: Pick<Connection, "getSignaturesForAddress">;
  decoder: Pick<TransactionDecoder, "decodeWalletCandidates">;
  candidates: WalletCandidateStore;
  trades: WalletTradeStore;
  statePath?: string;
  walletsPerRun?: number;
  signaturesPerWalletRun?: number;
  maxSignaturesPerWallet?: number;
}

const DEFAULT_STATE_PATH = "data/wallet-history-backfill.json";

/**
 * Conservative, resumable historical backfill. It scans a bounded number of
 * signatures per wallet and per cycle; the shared RPC fetch limiter is applied
 * by the Connection supplied by the caller. It never submits transactions.
 */
export class WalletHistoryBackfill {
  private readonly options: Required<Omit<WalletHistoryBackfillOptions, "connection" | "decoder" | "candidates" | "trades">> &
    Pick<WalletHistoryBackfillOptions, "connection" | "decoder" | "candidates" | "trades">;
  private state: BackfillState = { version: 1, wallets: {} };
  private initialized = false;
  private nextWalletIndex = 0;
  private running = false;

  constructor(options: WalletHistoryBackfillOptions) {
    this.options = {
      ...options,
      statePath: options.statePath ?? DEFAULT_STATE_PATH,
      walletsPerRun: options.walletsPerRun ?? 3,
      signaturesPerWalletRun: options.signaturesPerWalletRun ?? 20,
      maxSignaturesPerWallet: options.maxSignaturesPerWallet ?? 100,
    };
    for (const [name, value] of Object.entries({
      walletsPerRun: this.options.walletsPerRun,
      signaturesPerWalletRun: this.options.signaturesPerWalletRun,
      maxSignaturesPerWallet: this.options.maxSignaturesPerWallet,
    })) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await mkdir(dirname(this.options.statePath), { recursive: true });
    try {
      const parsed: unknown = JSON.parse(await readFile(this.options.statePath, "utf8"));
      if (typeof parsed !== "object" || parsed === null ||
        (parsed as BackfillState).version !== 1 ||
        typeof (parsed as BackfillState).wallets !== "object" ||
        (parsed as BackfillState).wallets === null) {
        throw new Error("Invalid wallet history backfill state");
      }
      this.state = parsed as BackfillState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.initialized = true;
  }

  async runBatch(): Promise<{ walletsVisited: number; signaturesScanned: number; tradesInserted: number }> {
    if (!this.initialized) throw new Error("WalletHistoryBackfill.init() must be called first");
    if (this.running) return { walletsVisited: 0, signaturesScanned: 0, tradesInserted: 0 };
    this.running = true;
    let walletsVisited = 0;
    let signaturesScanned = 0;
    let tradesInserted = 0;
    try {
      const wallets = this.options.candidates.list().map((candidate) => candidate.wallet);
      if (wallets.length === 0) return { walletsVisited, signaturesScanned, tradesInserted };
      const count = Math.min(this.options.walletsPerRun, wallets.length);
      for (let offset = 0; offset < count; offset++) {
        const wallet = wallets[(this.nextWalletIndex + offset) % wallets.length];
        if (!wallet) continue;
        const progress = this.state.wallets[wallet] ?? { scanned: 0, complete: false };
        if (progress.complete || progress.scanned >= this.options.maxSignaturesPerWallet) continue;
        walletsVisited++;
        const remaining = this.options.maxSignaturesPerWallet - progress.scanned;
        const limit = Math.min(this.options.signaturesPerWalletRun, remaining);
        const signatures = await this.options.connection.getSignaturesForAddress(
          new PublicKey(wallet),
          { ...(progress.before ? { before: progress.before } : {}), limit },
          "confirmed",
        );
        if (signatures.length === 0) {
          progress.complete = true;
          this.state.wallets[wallet] = progress;
          await this.persist();
          continue;
        }
        for (const info of signatures) {
          const decoded = await this.options.decoder.decodeWalletCandidates(info.signature);
          signaturesScanned++;
          for (const trade of decoded) {
            if (trade.wallet !== wallet || trade.timestamp === undefined || !trade.quoteAmountRaw ||
              trade.quoteSource !== "token_balance" || trade.quoteAmountIsEstimate !== false ||
              !trade.quoteMint || trade.quoteDecimals === undefined) continue;
            const observedAt = new Date(trade.timestamp * 1000).toISOString();
            const stored = await this.options.trades.record({
              wallet: trade.wallet,
              signature: trade.signature,
              mint: trade.mint,
              side: trade.side,
              tokenAmountRaw: trade.tokenAmountRaw,
              tokenDecimals: trade.tokenDecimals,
              ...(trade.tokenBalanceBeforeRaw === undefined ? {} : { tokenBalanceBeforeRaw: trade.tokenBalanceBeforeRaw }),
              ...(trade.tokenBalanceAfterRaw === undefined ? {} : { tokenBalanceAfterRaw: trade.tokenBalanceAfterRaw }),
              quoteAmountRaw: trade.quoteAmountRaw,
              quoteMint: trade.quoteMint,
              quoteDecimals: trade.quoteDecimals,
              quoteSource: "token_balance",
              quoteAmountIsEstimate: false,
              observedAt,
              slot: info.slot,
              timestampIsEstimated: false,
              ...(trade.dexProgramId ? { dexProgramId: trade.dexProgramId } : {}),
            });
            if (stored.inserted) tradesInserted++;

          }
          progress.before = info.signature;
          progress.scanned++;
          this.state.wallets[wallet] = progress;
          await this.persist();
        }
        if (signatures.length < limit) {
          progress.complete = true;
          this.state.wallets[wallet] = progress;
          await this.persist();
        }
      }
      this.nextWalletIndex = (this.nextWalletIndex + count) % wallets.length;
      return { walletsVisited, signaturesScanned, tradesInserted };
    } finally {
      this.running = false;
    }
  }

  private async persist(): Promise<void> {
    const temporary = `${this.options.statePath}.tmp`;
    await writeFile(temporary, JSON.stringify(this.state, null, 2), "utf8");
    await rename(temporary, this.options.statePath);
  }
}
