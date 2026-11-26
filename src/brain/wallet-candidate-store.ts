import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface WalletCandidateObservation {
  wallet: string;
  signature: string;
  slot: number;
  mint: string;
  side: "buy" | "sell";
  tokenAmountRaw: string;
  quoteAmountRaw?: string;
  quoteMint?: string;
  quoteDecimals?: number;
  quoteSource?: "token_balance" | "native_balance_estimate";
  quoteAmountIsEstimate?: boolean;
  dexProgramId?: string;
}

export interface StoredWalletCandidate {
  wallet: string;
  firstSeenAt: string;
  lastSeenAt: string;
  observationCount: number;
  recentObservations: Array<WalletCandidateObservation & { observedAt: string }>;
  /** Bounded keys prevent duplicate signatures from inflating the count. */
  recentKeys: string[];
}

interface CandidateStoreFile {
  version: 1;
  wallets: Record<string, StoredWalletCandidate>;
}

export interface WalletCandidateStoreOptions {
  filePath?: string;
  maxWallets?: number;
  maxRecentObservations?: number;
  maxRememberedKeys?: number;
  now?: () => Date;
}

const DEFAULT_FILE_PATH = "data/wallet-candidates.json";

export class WalletCandidateStore {
  private readonly filePath: string;
  private readonly maxWallets: number;
  private readonly maxRecentObservations: number;
  private readonly maxRememberedKeys: number;
  private readonly now: () => Date;
  private readonly wallets = new Map<string, StoredWalletCandidate>();
  private writeQueue: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(options: WalletCandidateStoreOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_FILE_PATH;
    this.maxWallets = options.maxWallets ?? 10_000;
    this.maxRecentObservations = options.maxRecentObservations ?? 20;
    this.maxRememberedKeys = options.maxRememberedKeys ?? 1_000;
    this.now = options.now ?? (() => new Date());

    if (!Number.isInteger(this.maxWallets) || this.maxWallets < 1) {
      throw new Error("maxWallets must be a positive integer");
    }
    if (!Number.isInteger(this.maxRecentObservations) || this.maxRecentObservations < 1) {
      throw new Error("maxRecentObservations must be a positive integer");
    }
    if (!Number.isInteger(this.maxRememberedKeys) || this.maxRememberedKeys < 1) {
      throw new Error("maxRememberedKeys must be a positive integer");
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await mkdir(dirname(this.filePath), { recursive: true });

    try {
      const content = await readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(content);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("version" in parsed) ||
        parsed.version !== 1 ||
        !("wallets" in parsed) ||
        typeof parsed.wallets !== "object" ||
        parsed.wallets === null ||
        Array.isArray(parsed.wallets)
      ) {
        throw new Error("Invalid wallet candidate store format");
      }

      for (const [wallet, candidate] of Object.entries(parsed.wallets)) {
        if (!this.isStoredCandidate(candidate, wallet)) {
          throw new Error(`Invalid stored wallet candidate: ${wallet}`);
        }
        this.wallets.set(wallet, candidate);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    this.initialized = true;
  }

  async record(observation: WalletCandidateObservation): Promise<StoredWalletCandidate> {
    this.assertInitialized();
    this.validateObservation(observation);

    const observedAt = this.now().toISOString();
    const key = `${observation.signature}:${observation.mint}`;
    const existing = this.wallets.get(observation.wallet);

    if (existing?.recentKeys.includes(key)) return existing;

    const recentObservation = { ...observation, observedAt };
    const updated: StoredWalletCandidate = existing
      ? {
          ...existing,
          lastSeenAt: observedAt,
          observationCount: existing.observationCount + 1,
          recentObservations: [...existing.recentObservations, recentObservation].slice(-this.maxRecentObservations),
          recentKeys: [...existing.recentKeys, key].slice(-this.maxRememberedKeys),
        }
      : {
          wallet: observation.wallet,
          firstSeenAt: observedAt,
          lastSeenAt: observedAt,
          observationCount: 1,
          recentObservations: [recentObservation],
          recentKeys: [key],
        };

    this.wallets.set(observation.wallet, updated);
    this.evictExcessWallets();

    await this.persist();
    return updated;
  }

  get(wallet: string): StoredWalletCandidate | undefined {
    this.assertInitialized();
    return this.wallets.get(wallet);
  }

  list(): StoredWalletCandidate[] {
    this.assertInitialized();
    return [...this.wallets.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  private async persist(): Promise<void> {
    const snapshot: CandidateStoreFile = {
      version: 1,
      wallets: Object.fromEntries(this.wallets),
    };
    const content = JSON.stringify(snapshot, null, 2);
    const temporaryPath = `${this.filePath}.tmp`;

    const write = async () => {
      await writeFile(temporaryPath, content, "utf8");
      await rename(temporaryPath, this.filePath);
    };

    this.writeQueue = this.writeQueue.then(write, write);
    await this.writeQueue;
  }

  private evictExcessWallets(): void {
    while (this.wallets.size > this.maxWallets) {
      let oldestWallet: string | undefined;
      let oldestSeenAt = "";
      for (const [wallet, candidate] of this.wallets) {
        if (oldestWallet === undefined || candidate.lastSeenAt < oldestSeenAt) {
          oldestWallet = wallet;
          oldestSeenAt = candidate.lastSeenAt;
        }
      }
      if (oldestWallet !== undefined) this.wallets.delete(oldestWallet);
    }
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error("WalletCandidateStore.init() must be called first");
  }

  private validateObservation(observation: WalletCandidateObservation): void {
    for (const field of ["wallet", "signature", "mint", "tokenAmountRaw"] as const) {
      if (typeof observation[field] !== "string" || observation[field].length === 0) {
        throw new Error(`${field} must be a non-empty string`);
      }
    }
    if (!Number.isSafeInteger(observation.slot) || observation.slot < 0) {
      throw new Error("slot must be a non-negative safe integer");
    }
    if (observation.side !== "buy" && observation.side !== "sell") {
      throw new Error("side must be buy or sell");
    }
    if (observation.quoteAmountRaw !== undefined && !/^\d+$/.test(observation.quoteAmountRaw)) {
      throw new Error("quoteAmountRaw must be a non-negative integer string");
    }
    if (observation.quoteDecimals !== undefined &&
      (!Number.isInteger(observation.quoteDecimals) || observation.quoteDecimals < 0 || observation.quoteDecimals > 18)) {
      throw new Error("quoteDecimals must be an integer between 0 and 18");
    }
  }

  private isStoredCandidate(value: unknown, wallet: string): value is StoredWalletCandidate {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as Partial<StoredWalletCandidate>;
    return (
      candidate.wallet === wallet &&
      typeof candidate.firstSeenAt === "string" &&
      typeof candidate.lastSeenAt === "string" &&
      Number.isSafeInteger(candidate.observationCount) &&
      (candidate.observationCount ?? 0) >= 1 &&
      Array.isArray(candidate.recentObservations) &&
      Array.isArray(candidate.recentKeys) &&
      candidate.recentKeys.every((key) => typeof key === "string")
    );
  }
}
