import { ParsedTransaction, ParsedTrade, Side, TokenBalance } from "./types.js";
import { logger } from "../core/logger.js";

// Known DEX program IDs for lookup
export const DEX_PROGRAM_IDS: Record<string, string> = {
  RAYDIUM_AMM: "675kPX9MHTjS2zt1qfr1NiuGePZB1GyzhjFuytX5k2Ud",
  RAYDIUM_CLMM: "CAMMCzo55L8kZRZ2JBfzPk5Ycg8pt4BjyVJeXO1ZLVjM",
  PUMP_FUN: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  JUPITER_V6: "JUP6LkbZBsp1EHb8ZBBkfCev5EwZ4f3iR1r7Z1yQz4T",
  METEORA: "MeteoraDydnn66p5yUa4Z8x7J3nE6vSgBQGZQa4xzV1T",
} as const;

/**
 * Detect which DEX program was involved in the transaction.
 * Returns the program ID string if found, undefined otherwise.
 */
export function detectDexProgram(tx: ParsedTransaction): string | undefined {
  const knownIds = Object.values(DEX_PROGRAM_IDS);
  for (const ix of tx.innerInstructions) {
    if (knownIds.includes(ix.programId)) {
      return ix.programId;
    }
  }
  return undefined;
}

/**
 * Parse a transaction to extract trade details based on DEX type.
 * Currently uses generic balance diff for all DEXs; future steps will add DEX-specific parsing.
 */
export function parseDexTrade(
  tx: ParsedTransaction,
  targetWallet: string,
): ParsedTrade | null {
  const dexProgramId = detectDexProgram(tx);
  if (!dexProgramId) {
    logger.debug({ signature: tx.signature }, "No known DEX program detected in transaction");
    return null;
  }

  // Group post balances by mint+owner for quick lookup
  const postByKey = new Map<string, TokenBalance>();
  for (const b of tx.postTokenBalances) {
    postByKey.set(`${b.owner}|${b.mint}`, b);
  }

  for (const pre of tx.preTokenBalances) {
    if (pre.owner !== targetWallet) continue;

    const post = postByKey.get(`${pre.owner}|${pre.mint}`);
    if (!post) {
      // Sold all tokens (balance disappeared)
      const amountOut = Number(pre.uiTokenAmount.uiAmount);
      if (amountOut > 0) {
        return buildTrade(tx, pre.mint, "sell", 0, amountOut, dexProgramId);
      }
      continue;
    }

    const preAmount = Number(pre.uiTokenAmount.uiAmount);
    const postAmount = Number(post.uiTokenAmount.uiAmount);
    const diff = postAmount - preAmount;

    if (diff > 0) {
      return buildTrade(tx, pre.mint, "buy", diff, 0, dexProgramId);
    }
    if (diff < 0) {
      return buildTrade(tx, pre.mint, "sell", 0, -diff, dexProgramId);
    }
  }

  logger.debug({ signature: tx.signature }, "No trade detected for target wallet");
  return null;
}

function buildTrade(
  tx: ParsedTransaction,
  mint: string,
  side: Side,
  amountIn: number,
  amountOut: number,
  dexProgramId: string,
): ParsedTrade {
  const timestamp = tx.blockTime != null ? tx.blockTime * 1000 : 0;

  return {
    signature: tx.signature,
    mint,
    side,
    amountIn,
    amountOut,
    dexProgramId,
    timestamp,
  } as ParsedTrade;
}