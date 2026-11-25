import { Connection, Context, Logs, PublicKey } from "@solana/web3.js";
import { config } from "../config/env.js";
import { logger } from "../core/logger.js";

// --- Types & contrats ---

export type OnTransaction = (signature: string, slot: number, accountChanges: AccountChange[]) => void;

export interface AccountChange {
  pubkey: string;
  lamports: number;
  before?: string[];
  after?: string[];
}

export interface RadarOptions {
  name?: string;
  wsRpcUrlOverride?: string;
  initialBackoffMs?: number;
  maxAttempts?: number;
  commitment?: "finalized" | "confirmed" | "processed";
}

export class Radar {
  private connection: Connection;
  private wsRpcUrl: string;
  private targetWallets: readonly string[];
  private commitment: "finalized" | "confirmed" | "processed";
  private onTransaction?: OnTransaction;
  private attempts = 0;
  private maxAttempts: number;
  private initialBackoffMs: number;
  private isRunning = false;

  constructor(options: RadarOptions = {}) {
    this.wsRpcUrl = options.wsRpcUrlOverride ?? config.rpcWsUrl;
    this.targetWallets = config.targetWallets;
    this.commitment = options.commitment ?? "confirmed";
    this.maxAttempts = options.maxAttempts ?? 10;
    this.initialBackoffMs = options.initialBackoffMs ?? 2000;
    this.connection = new Connection(config.rpcHttpUrl, this.commitment);
  }

  setOnTransaction(cb: OnTransaction): void {
    this.onTransaction = cb;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn({}, "Radar déjà en cours d'exécution");
      return;
    }
    this.isRunning = true;
    this.attempts = 0;
    logger.info({ wsUrl: this.wsRpcUrl, targetWallets: this.targetWallets }, "Radar démarré");
    await this._subscribeLoop();
  }

  stop(): void {
    this.isRunning = false;
    logger.info({}, "Radar arrêté");
  }

  private async _subscribeLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        this.attempts += 1;
        await this._doSubscribe();
      } catch (error: unknown) {
        logger.error({ attempt: this.attempts, error: (error as Error).message }, "Erreur lors de l'abonnement logsSubscribe");

        if (this.attempts >= this.maxAttempts) {
          logger.fatal({ attempt: this.attempts, maxAttempts: this.maxAttempts }, "Nombre maximal de tentatives atteint. Arrêt du radar.");
          this.stop();
          process.exit(1);
          return;
        }

        const backoff = this.initialBackoffMs * 2 ** (this.attempts - 1);
        logger.info({ attempt: this.attempts, backoffMs: backoff }, "Attente avant nouvelle tentative");
        await this._sleep(backoff);
      }
    }
  }

  private async _doSubscribe(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // LogsFilter = PublicKey | 'all' | 'allWithVotes'
      // On surveille un seul wallet cible pour l'instant ; le bot créera un Radar par wallet ensuite.
      const filter: PublicKey = new PublicKey(this.targetWallets[0] ?? "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1");

      const subId = this.connection.onLogs(
        filter,
        (logs: Logs, ctx: Context) => {
          try {
            if (!logs?.logs) {
              return;
            }
            const signature = logs.signature;
            const slot = ctx.slot;
            this.onTransaction?.(signature, slot, []);
          } catch (err: unknown) {
            logger.error({ error: (err as Error).message }, "Erreur dans le callback onTransaction du radar");
          }
        },
        this.commitment,
      );

      // Simule une déconnexion après 10s pour tester la reconnexion
      // En prod, la déconnexion viendra du serveur (close/error events)
      setTimeout(async () => {
        try {
          await this.connection.removeOnLogsListener(subId);
          resolve();
        } catch (err) {
          reject(err);
        }
      }, 10000);
    });
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const defaultRadar = new Radar();
defaultRadar.setOnTransaction(
  (signature, slot, accountChanges) => {
    logger.info(
      { signature, slot, accountChangesCount: accountChanges.length },
      "Transaction détectée par le radar",
    );
  },
);