import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { WalletRanking } from "./wallet-ranking.js";

export interface WalletSelectionRecord {
  wallet: string;
  quoteMint: string;
  reliabilityScore: number;
  firstSelectedAt: string;
  lastSelectedAt: string;
  selectionCount: number;
  active: boolean;
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
        this.wallets.set(key, value);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.initialized = true;
  }

  async sync(selected: readonly WalletRanking[]): Promise<WalletSelectionRecord[]> {
    this.assertInitialized();
    const now = this.now().toISOString();
    for (const [key, record] of this.wallets) {
      this.wallets.set(key, { ...record, active: false });
    }
    for (const item of selected) {
      if (item.reliabilityScore === null) continue;
      const key = this.keyOf(item.wallet, item.quoteMint);
      const previous = this.wallets.get(key);
      this.wallets.set(key, {
        wallet: item.wallet,
        quoteMint: item.quoteMint,
        reliabilityScore: item.reliabilityScore,
        firstSelectedAt: previous?.firstSelectedAt ?? now,
        lastSelectedAt: now,
        selectionCount: (previous?.selectionCount ?? 0) + (previous?.active ? 0 : 1),
        active: true,
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

  private isRecord(value: unknown): value is WalletSelectionRecord {
    if (typeof value !== "object" || value === null) return false;
    const item = value as Partial<WalletSelectionRecord>;
    return typeof item.wallet === "string" && item.wallet.length > 0 &&
      typeof item.quoteMint === "string" && item.quoteMint.length > 0 &&
      typeof item.reliabilityScore === "number" && Number.isFinite(item.reliabilityScore) &&
      item.reliabilityScore >= 0 && item.reliabilityScore <= 100 &&
      typeof item.firstSelectedAt === "string" && !Number.isNaN(Date.parse(item.firstSelectedAt)) &&
      typeof item.lastSelectedAt === "string" && !Number.isNaN(Date.parse(item.lastSelectedAt)) &&
      Number.isSafeInteger(item.selectionCount) && (item.selectionCount ?? 0) >= 1 &&
      typeof item.active === "boolean";
  }
}
