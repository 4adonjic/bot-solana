import { ParsedTransaction, ParsedTrade, Side, TokenBalance } from "./types.js";

// Program IDs are used only as transaction labels. Their presence does not
// prove that a wallet's token movement was a successful swap.
export const DEX_PROGRAM_IDS: Record<string, string> = {
  RAYDIUM_AMM: "675kPX9MHTjS2zt1qfr1NiuGePZB1GyzhjFuytX5k2Ud",
  RAYDIUM_CLMM: "CAMMCzo55L8kZRZ2JBfzPk5Ycg8pt4BjyVJeXO1ZLVjM",
  PUMP_FUN: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  JUPITER_V6: "JUP6LkbZBsp1EHb8ZBBkfCev5EwZ4f3iR1r7Z1yQz4T",
  METEORA: "MeteoraDydnn66p5yUa4Z8x7J3nE6vSgBQGZQa4xzV1T",
};

const QUOTE_MINTS = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
]);

/** Returns a known DEX program ID found in top-level or inner instructions. */
export function detectDexProgram(tx: ParsedTransaction): string | undefined {
  const knownIds = new Set(Object.values(DEX_PROGRAM_IDS));
  return tx.innerInstructions.find((instruction) =>
    knownIds.has(instruction.programId),
  )?.programId;
}

/**
 * Generic balance-diff parser retained for callers that already have a
 * normalized ParsedTransaction. It returns null rather than guessing when
 * several non-quote tokens changed.
 */
export function parseDexTrade(
  tx: ParsedTransaction,
  targetWallet: string,
): ParsedTrade | null {
  const totals = new Map<
    string,
    { mint: string; decimals: number; before: bigint; after: bigint }
  >();

  const add = (balances: TokenBalance[], side: "before" | "after") => {
    for (const balance of balances) {
      if (balance.owner !== targetWallet) continue;

      const current = totals.get(balance.mint) ?? {
        mint: balance.mint,
        decimals: balance.uiTokenAmount.decimals,
        before: 0n,
        after: 0n,
      };

      current[side] += BigInt(balance.uiTokenAmount.amount);
      current.decimals = balance.uiTokenAmount.decimals;
      totals.set(balance.mint, current);
    }
  };

  add(tx.preTokenBalances, "before");
  add(tx.postTokenBalances, "after");

  const candidates = [...totals.values()]
    .map((item) => ({ ...item, delta: item.after - item.before }))
    .filter((item) => item.delta !== 0n && !QUOTE_MINTS.has(item.mint));

  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    return null;
  }

  const item = candidates[0];
  if (!item) return null;

  const side: Side = item.delta > 0n ? "buy" : "sell";
  const rawAmount = (item.delta > 0n ? item.delta : -item.delta).toString();
  const uiAmount = Number(rawAmount) / 10 ** item.decimals;

  if (!Number.isFinite(uiAmount)) return null;

  return {
    wallet: targetWallet,
    signature: tx.signature,
    mint: item.mint,
    side,
    amountIn: side === "buy" ? uiAmount : 0,
    amountOut: side === "sell" ? uiAmount : 0,
    tokenAmountRaw: rawAmount,
    tokenDecimals: item.decimals,
    ...(detectDexProgram(tx) ? { dexProgramId: detectDexProgram(tx)! } : {}),
    ...(tx.blockTime == null ? {} : { timestamp: tx.blockTime * 1000 }),
  };
}
