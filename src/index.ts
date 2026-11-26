import { Connection } from "@solana/web3.js";
import { config } from "./config/env.js";
import { logger } from "./core/logger.js";
import { defaultRadar } from "./radar/radar.js";
import { defaultDecoder } from "./decoder/decoder.js";
import { analyzeTokenSecurity } from "./brain/security-pipeline.js";
import { createSecurityAnalysisCache } from "./brain/security-cache.js";

async function main(): Promise<void> {
  const connection = new Connection(config.rpcHttpUrl, "confirmed");
  const analyzeCachedSecurity = createSecurityAnalysisCache(
    (mint) => analyzeTokenSecurity(connection, mint),
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

  await defaultRadar.start();
}

main().catch((error: unknown) => {
  logger.error({ error }, "Erreur fatale au demarrage");
  process.exit(1);
});
