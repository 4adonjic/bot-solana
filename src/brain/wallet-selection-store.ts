import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { WalletRanking } from "./wallet-ranking.js";

export type WalletPerformanceTrend = "improving" | "stable" | "declining";

export interface WalletSelectionRecord {
  wallet: string;
  quoteMint: string;
  reliabilityScore: number;
  firstSelectedAt: string;
  lastSelectedAt: string;
  selectionCount: number;
  active: boolean;
  /** Last five ranking snapshots, oldest first. */
  scoreHistory: number[];
  trend: WalletPerformanceTrend;
}

interface SelectionStoreFile {
  version: 1;
  wallets: Record<string, WalletSelectionRecord>;
}

export interface WalletSelectionStoreOptions {
  filePath?: string;
  now?: () => Date;
}

const DEFAULT_FILE_PATH = "data/wallet-watchlist.json";
const SCORE_HISTORY_LIMIT = 5;
const DECLINE_THRESHOLD = 10;

export class WalletSelectionStore {
  private readonly filePath: string;
  private readonly now: () => Date;
  private readonly wallets = new Map<string, WalletSelectionRecord>();
  private writeQueue: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(options: WalletSelectionStoreOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_FILE_PATH;
    this.now = options.now ?? (() => new Date());
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
      if (typeof parsed !== "object" || parsed === null ||
        !("version" in parsed) || parsed.version !== 1 ||
        !("wallets" in parsed) || typeof parsed.wallets !== "object" ||
        parsed.wallets === null || Array.isArray(parsed.wallets)) {
        throw new Error("Invalid wallet watchlist format");
      }
      for (const [key, value] of Object.entries(parsed.wallets)) {
        if (!this.isRecord(value) || key !== this.keyOf(value.wallet, value.quoteMint)) {
          throw new Error(`Invalid wallet watchlist entry: ${key}`);
        }
        // Migrate entries created before score history was introduced.
        const scoreHistory = value.scoreHistory ?? [value.reliabilityScore];
        this.wallets.set(key, {
          ...value,
          scoreHistory,
          trend: value.trend ?? "stable",
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.initialized = true;
  }

  async sync(
    rankings: readonly WalletRanking[],
    selected: readonly WalletRanking[],
  ): Promise<WalletSelectionRecord[]> {
    this.assertInitialized();
    const now = this.now().toISOString();
    const rankingByKey = new Map(rankings.map((item) => [this.keyOf(item.wallet, item.quoteMint), item]));
    const selectedKeys = new Set(selected.map((item) => this.keyOf(item.wallet, item.quoteMint)));

    for (const [key, previous] of this.wallets) {
      const latest = rankingByKey.get(key);
      const scoreHistory = latest?.reliabilityScore === null || latest?.reliabilityScore === undefined
        ? previous.scoreHistory
        : [...previous.scoreHistory, latest.reliabilityScore].slice(-SCORE_HISTORY_LIMIT);
      const trend = latest ? this.calculateTrend(scoreHistory) : previous.trend;
      const active = selectedKeys.has(key) && trend !== "declining";
      this.wallets.set(key, {
        ...previous,
        ...(latest?.reliabilityScore === null || latest?.reliabilityScore === undefined
          ? {}
          : { reliabilityScore: latest.reliabilityScore }),
        ...(latest ? { scoreHistory, trend } : {}),
        lastSelectedAt: active ? now : previous.lastSelectedAt,
        selectionCount: previous.selectionCount + (active && !previous.active ? 1 : 0),
        active,
      });
    }

    for (const item of selected) {
      if (item.reliabilityScore === null) continue;
      const key = this.keyOf(item.wallet, item.quoteMint);
      if (this.wallets.has(key)) continue;
      this.wallets.set(key, {
        wallet: item.wallet,
        quoteMint: item.quoteMint,
        reliabilityScore: item.reliabilityScore,
        firstSelectedAt: now,
        lastSelectedAt: now,
        selectionCount: 1,
        active: true,
        scoreHistory: [item.reliabilityScore],
        trend: "stable",
      });
    }



    await this.persist();
    return this.list();
  }

  list(): WalletSelectionRecord[] {
    this.assertInitialized();
    return [...this.wallets.values()].sort((a, b) =>
      Number(b.active) - Number(a.active) ||
      b.reliabilityScore - a.reliabilityScore ||
      b.lastSelectedAt.localeCompare(a.lastSelectedAt),
    );
  }

  private calculateTrend(history: readonly number[]): WalletPerformanceTrend {
    if (history.length < 2) return "stable";
    const previousPeak = Math.max(...history.slice(0, -1));
    const latest = history[history.length - 1]!;
    if (latest <= previousPeak - DECLINE_THRESHOLD) return "declining";
    if (latest >= previousPeak + 5) return "improving";
    return "stable";
  }

  private isDeclining(history: readonly number[]): boolean {
    return this.calculateTrend(history) === "declining";
  }

  private keyOf(wallet: string, quoteMint: string): string {
    return JSON.stringify([wallet, quoteMint]);
  }

  private async persist(): Promise<void> {
    const content = JSON.stringify({ version: 1, wallets: Object.fromEntries(this.wallets) }, null, 2);
    const temporaryPath = `${this.filePath}.tmp`;
    const write = async () => {
      await writeFile(temporaryPath, content, "utf8");
      await rename(temporaryPath, this.filePath);
    };
    this.writeQueue = this.writeQueue.then(write, write);
    await this.writeQueue;
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error("WalletSelectionStore.init() must be called first");
  }

  private isRecord(value: unknown): value is WalletSelectionRecord & { scoreHistory?: number[]; trend?: WalletPerformanceTrend } {
    if (typeof value !== "object" || value === null) return false;
    const item = value as Partial<WalletSelectionRecord>;
    return typeof item.wallet === "string" && item.wallet.length > 0 &&
      typeof item.quoteMint === "string" && item.quoteMint.length > 0 &&
      typeof item.reliabilityScore === "number" && Number.isFinite(item.reliabilityScore) &&
      item.reliabilityScore >= 0 && item.reliabilityScore <= 100 &&
      typeof item.firstSelectedAt === "string" && !Number.isNaN(Date.parse(item.firstSelectedAt)) &&
      typeof item.lastSelectedAt === "string" && !Number.isNaN(Date.parse(item.lastSelectedAt)) &&
      Number.isSafeInteger(item.selectionCount) && (item.selectionCount ?? 0) >= 1 &&
      typeof item.active === "boolean" &&
      (item.scoreHistory === undefined || (Array.isArray(item.scoreHistory) &&
        item.scoreHistory.length >= 1 && item.scoreHistory.length <= SCORE_HISTORY_LIMIT &&
        item.scoreHistory.every((score) => typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 100))) &&
      (item.trend === undefined || item.trend === "improving" || item.trend === "stable" || item.trend === "declining");
  }
}
