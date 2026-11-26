import { Connection } from "@solana/web3.js";
import { config } from "./config/env.js";
import { logger } from "./core/logger.js";
import { defaultRadar } from "./radar/radar.js";
import { defaultDexRadar } from "./radar/dex-radar.js";
import { defaultDecoder } from "./decoder/decoder.js";
import { analyzeTokenSecurity } from "./brain/security-pipeline.js";
import { createSecurityAnalysisCache } from "./brain/security-cache.js";
import { createConcurrencyLimiter } from "./brain/concurrency-limit.js";
import { WalletCandidateStore } from "./brain/wallet-candidate-store.js";

async function main(): Promise<void> {
  const connection = new Connection(config.rpcHttpUrl, "confirmed");
  const analyzeLimitedSecurity = createConcurrencyLimiter(
    (mint: string) => analyzeTokenSecurity(connection, mint),
    { maxConcurrent: 2, maxQueued: 100 },
  );
  // Cache first: duplicate mints share one promise before entering the queue.
  const analyzeCachedSecurity = createSecurityAnalysisCache(
    analyzeLimitedSecurity,
    { ttlMs: 60_000, maxEntries: 500 },
  );

  const version = await connection.getVersion();
  logger.info(
    { rpcUrl: config.rpcHttpUrl, targetWallets: config.targetWallets, version },
    "Connexion RPC etablie - Module 1 initialise",
  );

  // Module 1 : surveillance des wallets cibles.
  // Modules 2 et 3 : décodage puis analyse de sécurité en lecture seule.
  defaultRadar.setOnTransaction(async (signature, slot) => {
    logger.info({ signature, slot }, "Transaction détectée par le radar, décodage en cours...");

    const trade = await defaultDecoder.decode(signature);
    if (!trade) return;

    logger.info(
      {
        signature: trade.signature,
        side: trade.side,
        mint: trade.mint,
        amountIn: trade.amountIn,
        amountOut: trade.amountOut,
        dexProgramId: trade.dexProgramId,
      },
      "Trade détecté et décodé",
    );

    try {
      const report = await analyzeCachedSecurity(trade.mint);
      logger.info(
        {
          mint: report.mint,
          decision: report.assessment.decision,
          riskScore: report.assessment.riskScore,
          reasons: report.assessment.reasons,
          missingChecks: report.assessment.missingChecks,
          snapshot: report.snapshot,
          sourceErrors: report.sourceErrors,
        },
        "Analyse de sécurité du token terminée (lecture seule)",
      );
    } catch (error) {
      // A security-analysis failure must never stop the radar.
      logger.error({ mint: trade.mint, error }, "Échec inattendu de l'analyse de sécurité");
    }
  });

  if (config.targetWallets.length > 0) {
    await defaultRadar.start();
  } else {
    logger.info("Aucun wallet manuel configuré : radar ciblé désactivé.");
  }

  if (config.enableDexDiscovery) {
    const candidateStore = new WalletCandidateStore();
    await candidateStore.init();
    logger.info(
      { candidateWalletsLoaded: candidateStore.list().length },
      "Registre persistant des wallets candidats chargé",
    );

    defaultDexRadar.setOnTransaction(async (signature, slot) => {
      const candidates = await defaultDecoder.decodeWalletCandidates(signature);
      if (candidates.length === 0) return;

      for (const candidate of candidates) {
        try {
          const stored = await candidateStore.record({
            wallet: candidate.wallet,
            signature: candidate.signature,
            slot,
            mint: candidate.mint,
            side: candidate.side,
            tokenAmountRaw: candidate.tokenAmountRaw,
            ...(candidate.dexProgramId ? { dexProgramId: candidate.dexProgramId } : {}),
          });

          logger.info(
            {
              wallet: stored.wallet,
              signature: candidate.signature,
              slot,
              mint: candidate.mint,
              side: candidate.side,
              observationCount: stored.observationCount,
              firstSeenAt: stored.firstSeenAt,
              lastSeenAt: stored.lastSeenAt,
            },
            "Wallet candidat enregistré (observation uniquement)",
          );
        } catch (error) {
          logger.error(
            { wallet: candidate.wallet, signature, error },
            "Impossible d'enregistrer le wallet candidat",
          );
        }
      }
    });

    await defaultDexRadar.start();
  } else {
    logger.info(
      "Découverte DEX désactivée. Définir ENABLE_DEX_DISCOVERY=true pour activer le flux.",
    );
  }
}

main().catch((error: unknown) => {
  logger.error({ error }, "Erreur fatale au demarrage");
  process.exit(1);
});
