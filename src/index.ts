import { mkdir, writeFile, rename } from "node:fs/promises";
import { Connection } from "@solana/web3.js";
import { config } from "./config/env.js";
import { logger } from "./core/logger.js";
import { rateLimitedRpcFetch } from "./core/rpc-fetch.js";
import { defaultRadar } from "./radar/radar.js";
import { defaultDexRadar } from "./radar/dex-radar.js";
import { defaultDecoder } from "./decoder/decoder.js";
import { analyzeTokenSecurity } from "./brain/security-pipeline.js";
import { createSecurityAnalysisCache } from "./brain/security-cache.js";
import { createConcurrencyLimiter } from "./brain/concurrency-limit.js";
import { WalletCandidateStore } from "./brain/wallet-candidate-store.js";
import { WalletTradeStore } from "./brain/wallet-trade-store.js";
import { WalletHistoryBackfill } from "./brain/wallet-history-backfill.js";
import { calculateWalletPerformance } from "./brain/wallet-performance.js";
import { rankWallets } from "./brain/wallet-ranking.js";
import { selectWalletsForPaperTrading, walletSelectionKey } from "./brain/wallet-selection.js";
import { WalletSelectionStore } from "./brain/wallet-selection-store.js";
import { PaperTradingEngine } from "./brain/paper-trading.js";
import { JupiterQuoteProvider } from "./brain/jupiter-quote-provider.js";

async function main(): Promise<void> {
  const connection = new Connection(config.rpcHttpUrl, { commitment: "confirmed", fetch: rateLimitedRpcFetch });
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
    const historyBackfill = new WalletHistoryBackfill({
      connection,
      decoder: defaultDecoder,
      candidates: candidateStore,
      trades: tradeStore,
      walletsPerRun: 1,
      signaturesPerWalletRun: 5,
      maxSignaturesPerWallet: 5_000,
    });
    await historyBackfill.init();
    const selectionStore = new WalletSelectionStore();
    await selectionStore.init();
    const jupiterQuotes = config.enablePaperTrading
      ? new JupiterQuoteProvider({ ...(config.jupiterApiKey ? { apiKey: config.jupiterApiKey } : {}) })
      : null;
    const paperEngine = config.enablePaperTrading
      ? new PaperTradingEngine({
          quoteProvider: (inputMint, outputMint, amountRaw) =>
            jupiterQuotes!.getQuote(inputMint, outputMint, amountRaw),
          copyDelayMs: 3_000,
          minSlippageBps: 200,
          maxSlippageBps: 500,
          maxPriceImpactPercent: 5,
          maxPositionPercent: 20,
          maxPortfolioExposurePercent: 60,
          maxDailyLossPercent: 5,
          feeBps: 10,
        })
      : null;
    let selectedWalletKeys = new Set<string>();
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
          copyDelayMs: 3_000,
          slippageRangeBps: [200, 500],
          maxPriceImpactPercent: 5,
          maxPositionPercent: 20,
          maxPortfolioExposurePercent: 60,
          maxDailyLossPercent: 5,
          minimumLiquidityUsd: 20_000,
          feeBps: 10,
          marketQuotes: "Jupiter Swap API v2 (read-only)",
          stateFile: "data/paper-trading.json",
        },
        "PAPER TRADING ACTIF : portefeuille fictif uniquement, aucune transaction blockchain ne sera envoyée",
      );
    }
    // Serialize refreshes: backfill, live discovery and the periodic monitor
    // can all request a ranking update at nearly the same time.
    let rankingRefreshQueue: Promise<void> = Promise.resolve();
    const refreshWalletRanking = (): Promise<void> => {
      const refresh = rankingRefreshQueue.then(async (): Promise<void> => {
    const performance = calculateWalletPerformance(tradeStore.list());
    const rankings = rankWallets(performance);
    // Persist every evaluated wallet, including provisional/ineligible rankings,
    // so the desktop dashboard can explain why a candidate is not selected.
    await mkdir("data", { recursive: true });
    const rankingPath = "data/wallet-rankings.json";
    const rankingTempPath = rankingPath + ".tmp";
    await writeFile(rankingTempPath, JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      wallets: rankings,
    }, null, 2), "utf8");
    await rename(rankingTempPath, rankingPath);
    const eligible = rankings.filter((item) => item.eligible);
    const selected = selectWalletsForPaperTrading(rankings);
    const persistentWatchlist = await selectionStore.sync(rankings, selected);
    selectedWalletKeys = new Set(persistentWatchlist.filter((item) => item.active)
      .map((item) => walletSelectionKey(item.wallet, item.quoteMint)));
    logger.info(
      {
        historicalTradesLoaded: tradeStore.count(),
        performanceGroupsLoaded: performance.length,
        walletsWithEnoughData: eligible.length,
        topWallets: eligible.slice(0, 10),
        selectedForPaperTrading: persistentWatchlist.filter((item) => item.active),
        persistentWatchlist,
      },
      "Classement des wallets et sélection automatique Paper Trading (score minimum 65, maximum 10)",
    );
      });
      rankingRefreshQueue = refresh.catch((error: unknown) => {
        logger.error({ error }, "Échec du recalcul périodique du classement des wallets");
      });
      return refresh;
    };
    logger.info(
      { candidateWalletsLoaded: candidateStore.list().length, historicalTradesLoaded: tradeStore.count() },
      "Registres persistants chargés",
    );
    await refreshWalletRanking();
    const runHistoryBackfill = async (): Promise<void> => {
      try {
        const result = await historyBackfill.runBatch();
        if (result.signaturesScanned > 0) {
          logger.info(result, "Backfill historique des wallets (lecture seule)");
          if (result.tradesInserted > 0) await refreshWalletRanking();
        }
      } catch (error) {
        logger.warn({ error }, "Échec d’un lot de backfill historique; reprise au prochain cycle");
      }
    };
    void runHistoryBackfill();
    const historyBackfillInterval = setInterval(() => void runHistoryBackfill(), 15_000);
    historyBackfillInterval.unref();

    // Reassess the full rolling 14-day window even during quiet periods.
    // This lets wallets expire out of eligibility and updates the watchlist
    // without waiting for another 100 newly discovered trades.
    const WALLET_REASSESSMENT_INTERVAL_MS = 5 * 60_000;
    const walletReassessmentInterval = setInterval(() => {
      void refreshWalletRanking().catch((error: unknown) => {
        logger.error({ error }, "Échec de la réévaluation périodique des wallets");
      });
    }, WALLET_REASSESSMENT_INTERVAL_MS);
    walletReassessmentInterval.unref();
    let newTradesSinceRanking = 0;
    const rankingRefreshInterval = 100;
    // Keep discovery below the shared Helius HTTP RPC budget. DEX logs can
    // arrive in large bursts, so sample before enqueueing any transaction fetch.
    const DEX_DECODE_MIN_INTERVAL_MS = 250; // at most 4 transaction fetches/second
    const decodeCandidatesLimited = createConcurrencyLimiter(
      (signature: string) => defaultDecoder.decodeWalletCandidates(signature),
      { maxConcurrent: 2, maxQueued: 20 },
    );
    let nextDexDecodeAt = 0;
    const dexStats = {
      eventsReceived: 0,
      sampledOut: 0,
      queueFull: 0,
      transactionsDecoded: 0,
      candidateTrades: 0,
    };
    const dexStatsInterval = setInterval(() => {
      const snapshot = { ...dexStats };
      dexStats.eventsReceived = 0;
      dexStats.sampledOut = 0;
      dexStats.queueFull = 0;
      dexStats.transactionsDecoded = 0;
      dexStats.candidateTrades = 0;
      logger.info(snapshot, "Statistiques du flux DEX (intervalle de 15 secondes)");
    }, 15_000);
    dexStatsInterval.unref();

    defaultDexRadar.setOnTransaction(async (signature, slot) => {
      dexStats.eventsReceived += 1;
      const now = Date.now();
      if (now < nextDexDecodeAt) {
        dexStats.sampledOut += 1;
        return;
      }
      nextDexDecodeAt = now + DEX_DECODE_MIN_INTERVAL_MS;

      let candidates;
      try {
        candidates = await decodeCandidatesLimited(signature);
      } catch {
        // Queue pressure is reported by the periodic aggregate below, not per event.
        dexStats.queueFull += 1;
        return;
      }
      dexStats.transactionsDecoded += 1;
      dexStats.candidateTrades += candidates.length;
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
              await refreshWalletRanking();
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
            if (!leader?.eligible || !selectedWalletKeys.has(walletSelectionKey(candidate.wallet, candidate.quoteMint))) {
              logger.debug(
                { wallet: candidate.wallet, quoteMint: candidate.quoteMint, matchedSells: leader?.matchedSellCount ?? 0, activeDays: leader?.activeDays ?? 0 },
                "Paper Trading ignoré : wallet non retenu par la sélection automatique (échantillon, rentabilité ou score insuffisant)",
              );
            } else {
              const security = await analyzeCachedSecurity(candidate.mint);
              if (
                security.assessment.decision !== "allow" ||
                typeof security.snapshot.liquidityUsd !== "number" ||
                security.snapshot.liquidityUsd < 20_000
              ) {
                logger.info(
                  {
                    wallet: candidate.wallet,
                    mint: candidate.mint,
                    decision: security.assessment.decision,
                    riskScore: security.assessment.riskScore,
                    liquidityUsd: security.snapshot.liquidityUsd,
                    minimumLiquidityUsd: 20_000,
                    missingChecks: security.assessment.missingChecks,
                  },
                  "Paper Trading ignoré : sécurité ou liquidité minimale non validée",
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
