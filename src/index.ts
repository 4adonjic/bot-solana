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
import { WalletTradeStore } from "./brain/wallet-trade-store.js";
import { calculateWalletPerformance } from "./brain/wallet-performance.js";
import { rankWallets } from "./brain/wallet-ranking.js";
import { PaperTradingEngine } from "./brain/paper-trading.js";

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
        quoteAmountRaw: trade.quoteAmountRaw,
        quoteMint: trade.quoteMint,
        quoteDecimals: trade.quoteDecimals,
        quoteSource: trade.quoteSource,
        quoteAmountIsEstimate: trade.quoteAmountIsEstimate,
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
    const tradeStore = new WalletTradeStore();
    await tradeStore.init();
    const paperEngine = config.enablePaperTrading ? new PaperTradingEngine() : null;
    if (paperEngine) {
      await paperEngine.init();
      const paperSnapshot = paperEngine.snapshot();
      logger.warn(
        {
          virtualBalancesRaw: paperSnapshot.balances,
          openPositions: paperSnapshot.positions.length,
          simulatedFills: paperSnapshot.fills.length,
          defaultStartingBalances: { SOL: "1", USDC: "100" },
          fixedBuySizes: { SOL: "0.05", USDC: "5" },
          slippageBps: 50,
          feeBps: 10,
          stateFile: "data/paper-trading.json",
        },
        "PAPER TRADING ACTIF : portefeuille fictif uniquement, aucune transaction blockchain ne sera envoyée",
      );
    }
    const refreshWalletRanking = (): void => {
      const performance = calculateWalletPerformance(tradeStore.list());
      const rankings = rankWallets(performance);
      const eligible = rankings.filter((item) => item.eligible);
      logger.info(
        {
          historicalTradesLoaded: tradeStore.count(),
          performanceGroupsLoaded: performance.length,
          walletsWithEnoughData: eligible.length,
          topWallets: eligible.slice(0, 10),
        },
        "Classement des wallets (PnL brut, cotation séparée, échantillon minimum)",
      );
    };
    logger.info(
      { candidateWalletsLoaded: candidateStore.list().length, historicalTradesLoaded: tradeStore.count() },
      "Registres persistants chargés",
    );
    refreshWalletRanking();
    let newTradesSinceRanking = 0;
    const rankingRefreshInterval = 100;

    defaultDexRadar.setOnTransaction(async (signature, slot) => {
      const candidates = await defaultDecoder.decodeWalletCandidates(signature);
      if (candidates.length === 0) return;

      for (const candidate of candidates) {
        try {
          const observedAt = candidate.timestamp === undefined
            ? new Date().toISOString()
            : new Date(candidate.timestamp * 1000).toISOString();
          const historyResult = await tradeStore.record({
            wallet: candidate.wallet,
            signature: candidate.signature,
            mint: candidate.mint,
            side: candidate.side,
            tokenAmountRaw: candidate.tokenAmountRaw,
            tokenDecimals: candidate.tokenDecimals,
            ...(candidate.tokenBalanceBeforeRaw === undefined ? {} : { tokenBalanceBeforeRaw: candidate.tokenBalanceBeforeRaw }),
            ...(candidate.tokenBalanceAfterRaw === undefined ? {} : { tokenBalanceAfterRaw: candidate.tokenBalanceAfterRaw }),
            observedAt,
            slot,
            timestampIsEstimated: candidate.timestamp === undefined,
            ...(candidate.quoteAmountRaw ? { quoteAmountRaw: candidate.quoteAmountRaw } : {}),
            ...(candidate.quoteMint ? { quoteMint: candidate.quoteMint } : {}),
            ...(candidate.quoteDecimals === undefined ? {} : { quoteDecimals: candidate.quoteDecimals }),
            ...(candidate.quoteSource ? { quoteSource: candidate.quoteSource } : {}),
            ...(candidate.quoteAmountIsEstimate === undefined ? {} : { quoteAmountIsEstimate: candidate.quoteAmountIsEstimate }),
            ...(candidate.dexProgramId ? { dexProgramId: candidate.dexProgramId } : {}),
          });
          if (historyResult.inserted) {
            newTradesSinceRanking++;
            if (newTradesSinceRanking >= rankingRefreshInterval) {
              refreshWalletRanking();
              newTradesSinceRanking = 0;
            }
          }
          const stored = await candidateStore.record({
            wallet: candidate.wallet,
            signature: candidate.signature,
            slot,
            mint: candidate.mint,
            side: candidate.side,
            tokenAmountRaw: candidate.tokenAmountRaw,
            ...(candidate.quoteAmountRaw ? { quoteAmountRaw: candidate.quoteAmountRaw } : {}),
            ...(candidate.quoteMint ? { quoteMint: candidate.quoteMint } : {}),
            ...(candidate.quoteDecimals === undefined ? {} : { quoteDecimals: candidate.quoteDecimals }),
            ...(candidate.quoteSource ? { quoteSource: candidate.quoteSource } : {}),
            ...(candidate.quoteAmountIsEstimate === undefined ? {} : { quoteAmountIsEstimate: candidate.quoteAmountIsEstimate }),
            ...(candidate.dexProgramId ? { dexProgramId: candidate.dexProgramId } : {}),
          });

          if (paperEngine && historyResult.inserted && candidate.quoteMint) {
            const ranking = rankWallets(calculateWalletPerformance(tradeStore.list()));
            const leader = ranking.find((item) =>
              item.wallet === candidate.wallet && item.quoteMint === candidate.quoteMint,
            );
            if (!leader?.eligible) {
              logger.debug(
                { wallet: candidate.wallet, quoteMint: candidate.quoteMint, matchedSells: leader?.matchedSellCount ?? 0, activeDays: leader?.activeDays ?? 0 },
                "Paper Trading ignoré : wallet pas encore assez documenté",
              );
            } else {
              const security = await analyzeCachedSecurity(candidate.mint);
              if (security.assessment.decision !== "allow") {
                logger.info(
                  { wallet: candidate.wallet, mint: candidate.mint, decision: security.assessment.decision, riskScore: security.assessment.riskScore, missingChecks: security.assessment.missingChecks },
                  "Paper Trading ignoré : sécurité du token non validée",
                );
              } else {
                const paperResult = await paperEngine.processTrade({
                  wallet: candidate.wallet,
                  signature: candidate.signature,
                  mint: candidate.mint,
                  side: candidate.side,
                  tokenAmountRaw: candidate.tokenAmountRaw,
                  ...(candidate.tokenBalanceBeforeRaw === undefined ? {} : { tokenBalanceBeforeRaw: candidate.tokenBalanceBeforeRaw }),
                  ...(candidate.tokenBalanceAfterRaw === undefined ? {} : { tokenBalanceAfterRaw: candidate.tokenBalanceAfterRaw }),
                  quoteMint: candidate.quoteMint,
                  observedAt,
                  ...(candidate.quoteAmountRaw ? { quoteAmountRaw: candidate.quoteAmountRaw } : {}),
                  ...(candidate.quoteDecimals === undefined ? {} : { quoteDecimals: candidate.quoteDecimals }),
                  ...(candidate.quoteSource ? { quoteSource: candidate.quoteSource } : {}),
                  ...(candidate.quoteAmountIsEstimate === undefined ? {} : { quoteAmountIsEstimate: candidate.quoteAmountIsEstimate }),
                  slot,
                });
                if (paperResult.executed) {
                  logger.info(
                    { ...paperResult.fill, virtualBalanceRaw: paperResult.balanceRaw, openPosition: paperResult.position },
                    "ORDRE SIMULÉ exécuté (aucune transaction réelle)",
                  );
                } else {
                  logger.debug(
                    { wallet: candidate.wallet, mint: candidate.mint, side: candidate.side, reason: paperResult.reason },
                    "Ordre Paper Trading non exécuté",
                  );
                }
              }
            }
          }

          logger.info(
            {
              wallet: stored.wallet,
              signature: candidate.signature,
              slot,
              mint: candidate.mint,
              side: candidate.side,
              tokenAmountRaw: candidate.tokenAmountRaw,
              tokenBalanceBeforeRaw: candidate.tokenBalanceBeforeRaw,
              tokenBalanceAfterRaw: candidate.tokenBalanceAfterRaw,
              quoteAmountRaw: candidate.quoteAmountRaw,
              quoteMint: candidate.quoteMint,
              quoteSource: candidate.quoteSource,
              quoteAmountIsEstimate: candidate.quoteAmountIsEstimate,
              observationCount: stored.observationCount,
              historyInserted: historyResult.inserted,
              historicalTradeCount: tradeStore.count(),
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
