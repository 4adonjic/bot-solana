import { Connection, Context, Logs, PublicKey } from "@solana/web3.js";
import { config } from "../config/env.js";
import { logger } from "../core/logger.js";
import { DEX_PROGRAM_IDS } from "../decoder/dex.js";

export type OnDexTransaction = (signature: string, slot: number) => void | Promise<void>;

export interface DexRadarOptions {
  commitment?: "finalized" | "confirmed" | "processed";
  maxSeenSignatures?: number;
}

/**
 * Read-only feed of transactions touching known DEX programs.
 * This discovers transaction signatures; it does not execute or submit trades.
 */
export class DexRadar {
  private readonly connection: Connection;
  private readonly commitment: "finalized" | "confirmed" | "processed";
  private readonly maxSeenSignatures: number;
  private readonly subscriptions = new Map<number, string>();
  private readonly seenSignatures = new Set<string>();
  private onTransaction?: OnDexTransaction;
  private isRunning = false;

  constructor(options: DexRadarOptions = {}) {
    this.commitment = options.commitment ?? "confirmed";
    this.maxSeenSignatures = options.maxSeenSignatures ?? 5_000;
    this.connection = new Connection(config.rpcHttpUrl, {
      commitment: this.commitment,
      wsEndpoint: config.rpcWsUrl,
    });
  }

  setOnTransaction(callback: OnDexTransaction): void {
    this.onTransaction = callback;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    const programs = [...new Set(Object.values(DEX_PROGRAM_IDS))];
    logger.info({ programCount: programs.length }, "Démarrage du flux de transactions DEX");

    try {
      for (const programId of programs) {
        if (!this.isRunning) break;
        const subscriptionId = this.connection.onLogs(
          new PublicKey(programId),
          (logs: Logs, context: Context) => {
            if (!logs?.signature || logs.err !== null || !this.isRunning) return;
            if (this.seenSignatures.has(logs.signature)) return;

            this.seenSignatures.add(logs.signature);
            if (this.seenSignatures.size > this.maxSeenSignatures) {
              const oldest = this.seenSignatures.values().next().value;
              if (oldest) this.seenSignatures.delete(oldest);
            }

            try {
              const result = this.onTransaction?.(logs.signature, context.slot);
              if (result && typeof result.then === "function") {
                void result.catch((error: unknown) =>
                  logger.error({ signature: logs.signature, error }, "Échec du traitement d'une transaction DEX"),
                );
              }
            } catch (error: unknown) {
              logger.error({ signature: logs.signature, error }, "Erreur du callback DEX");
            }
          },
          this.commitment,
        );
        this.subscriptions.set(subscriptionId, programId);
      }
    } catch (error: unknown) {
      await this.stop();
      throw error;
    }

    logger.info(
      { subscriptionCount: this.subscriptions.size, programs },
      "Flux de transactions DEX actif",
    );
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    const ids = [...this.subscriptions.keys()];
    this.subscriptions.clear();
    const results = await Promise.allSettled(ids.map((id) => this.connection.removeOnLogsListener(id)));
    const failed = results.filter((result) => result.status === "rejected").length;
    if (failed > 0) logger.warn({ failed }, "Certaines souscriptions DEX n'ont pas été supprimées");
    logger.info({ removedSubscriptions: ids.length }, "Flux DEX arrêté");
  }
}

export const defaultDexRadar = new DexRadar();
