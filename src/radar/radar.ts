import { Connection, Context, Logs, PublicKey } from "@solana/web3.js";
import { config } from "../config/env.js";
import { logger } from "../core/logger.js";
import { rateLimitedRpcFetch } from "../core/rpc-fetch.js";

export interface AccountChange {
  pubkey: string;
  lamports: number;
  before?: string[];
  after?: string[];
}

export type OnTransaction = (
  signature: string,
  slot: number,
  accountChanges: AccountChange[],
) => void;

export interface RadarOptions {
  wsRpcUrlOverride?: string;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  maxAttempts?: number;
  commitment?: "finalized" | "confirmed" | "processed";
}

/**
 * Écoute les logs de chaque wallet cible.
 *
 * web3.js gère la reconnexion de son WebSocket. Cette classe gère les erreurs
 * lors de la création initiale des abonnements et leur nettoyage à l'arrêt.
 */
export class Radar {
  private readonly connection: Connection;
  private readonly targetWallets: readonly string[];
  private readonly commitment: "finalized" | "confirmed" | "processed";
  private readonly maxAttempts: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly subscriptions = new Map<number, string>();

  private onTransaction?: OnTransaction;
  private isRunning = false;

  constructor(options: RadarOptions = {}) {
    const wsRpcUrl = options.wsRpcUrlOverride ?? config.rpcWsUrl;

    this.targetWallets = [...new Set(config.targetWallets)];
    this.commitment = options.commitment ?? "confirmed";
    this.maxAttempts = options.maxAttempts ?? 10;
    this.initialBackoffMs = options.initialBackoffMs ?? 2_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000;

    this.connection = new Connection(config.rpcHttpUrl, {
      commitment: this.commitment,
      wsEndpoint: wsRpcUrl,
      fetch: rateLimitedRpcFetch,
    });
  }

  setOnTransaction(callback: OnTransaction): void {
    this.onTransaction = callback;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn({}, "Radar déjà en cours d'exécution");
      return;
    }

    this.isRunning = true;
    logger.info(
      { targetWallets: this.targetWallets, walletCount: this.targetWallets.length },
      "Démarrage du radar Solana",
    );

    await this.subscribeWithRetry();
  }

  async stop(): Promise<void> {
    if (!this.isRunning && this.subscriptions.size === 0) {
      return;
    }

    this.isRunning = false;

    const subscriptionIds = [...this.subscriptions.keys()];
    this.subscriptions.clear();

    const results = await Promise.allSettled(
      subscriptionIds.map((id) => this.connection.removeOnLogsListener(id)),
    );

    const failedRemovals = results.filter((result) => result.status === "rejected");
    if (failedRemovals.length > 0) {
      logger.warn(
        { failedCount: failedRemovals.length },
        "Certaines souscriptions du radar n'ont pas pu être supprimées",
      );
    }

    logger.info({ removedSubscriptions: subscriptionIds.length }, "Radar arrêté");
  }

  private async subscribeWithRetry(): Promise<void> {
    for (let attempt = 1; attempt <= this.maxAttempts && this.isRunning; attempt += 1) {
      try {
        await this.subscribeAllWallets();
        logger.info(
          { subscriptionCount: this.subscriptions.size },
          "Tous les wallets cibles sont surveillés",
        );
        return;
      } catch (error: unknown) {
        await this.removeAllSubscriptions();

        logger.error(
          { attempt, error: this.getErrorMessage(error) },
          "Échec de création des abonnements logsSubscribe",
        );

        if (attempt === this.maxAttempts) {
          this.isRunning = false;
          logger.fatal(
            { maxAttempts: this.maxAttempts },
            "Nombre maximal de tentatives atteint : le radar ne peut pas démarrer",
          );
          throw error;
        }

        const backoffMs = Math.min(
          this.initialBackoffMs * 2 ** (attempt - 1),
          this.maxBackoffMs,
        );

        logger.info({ attempt, backoffMs }, "Nouvelle tentative de connexion du radar");
        await this.sleep(backoffMs);
      }
    }
  }

  private async subscribeAllWallets(): Promise<void> {
    if (this.targetWallets.length === 0) {
      throw new Error("Aucun wallet cible n'est configuré");
    }

    for (const walletAddress of this.targetWallets) {
      if (!this.isRunning) {
        return;
      }

      const wallet = new PublicKey(walletAddress);
      const subscriptionId = this.connection.onLogs(
        wallet,
        (logs: Logs, context: Context) => {
          if (!logs?.signature) {
            return;
          }

          try {
            this.onTransaction?.(logs.signature, context.slot, []);
          } catch (error: unknown) {
            logger.error(
              { wallet: walletAddress, error: this.getErrorMessage(error) },
              "Erreur dans le callback de transaction du radar",
            );
          }
        },
        this.commitment,
      );

      this.subscriptions.set(subscriptionId, walletAddress);
      logger.debug({ wallet: walletAddress, subscriptionId }, "Wallet ajouté à la surveillance");
    }
  }

  private async removeAllSubscriptions(): Promise<void> {
    const subscriptionIds = [...this.subscriptions.keys()];
    this.subscriptions.clear();

    await Promise.allSettled(
      subscriptionIds.map((id) => this.connection.removeOnLogsListener(id)),
    );
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

export const defaultRadar = new Radar();
