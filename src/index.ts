import { Connection } from "@solana/web3.js";
import { config } from "./config/env.js";
import { logger } from "./core/logger.js";
import { defaultRadar } from "./radar/radar.js";
import { defaultDecoder } from "./decoder/decoder.js";

async function main(): Promise<void> {
  const connection = new Connection(config.rpcHttpUrl, "confirmed");

  const version = await connection.getVersion();
  logger.info(
    { rpcUrl: config.rpcHttpUrl, targetWallets: config.targetWallets, version },
    "Connexion RPC etablie - Module 1 initialise",
  );

  // Module 1 : demarrage du radar d'ecoute temps reel
  // Module 2 : decode chaque transaction detectee en ParsedTrade
  defaultRadar.setOnTransaction(async (signature, slot) => {
    logger.info({ signature, slot }, "Transaction détectée par le radar, décodage en cours...");

    const trade = await defaultDecoder.decode(signature);
    if (trade) {
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
    }
  });

  await defaultRadar.start();
}

main().catch((error: unknown) => {
  logger.error({ error }, "Erreur fatale au demarrage");
  process.exit(1);
});
