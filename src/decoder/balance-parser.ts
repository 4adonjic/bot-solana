import type { ParsedTrade, ParsedTransaction, TokenBalance } from "./types.js";
import { detectDexProgram } from "./dex.js";

const QUOTE_MINTS = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
]);

/**
 * Pure balance-diff parser, exported so it can be tested without an RPC.
 * A single trade is returned only when exactly one non-quote mint changed.
 */
export function parseTokenBalanceChanges(
  tx: ParsedTransaction,
  targetWallets: readonly string[],
): ParsedTrade | null {
  const changes = new Map<
    string,
    { mint: string; decimals: number; before: bigint; after: bigint }
  >();

  const addBalances = (balances: TokenBalance[], side: "before" | "after") => {
    for (const balance of balances) {
      if (!targetWallets.includes(balance.owner)) continue;

      const key = `${balance.owner}|${balance.mint}`;
      const current = changes.get(key) ?? {
        mint: balance.mint,
        decimals: balance.uiTokenAmount.decimals,
        before: 0n,
        after: 0n,
      };

      current[side] += BigInt(balance.uiTokenAmount.amount);
      current.decimals = balance.uiTokenAmount.decimals;
      changes.set(key, current);
    }
  };

  addBalances(tx.preTokenBalances, "before");
  addBalances(tx.postTokenBalances, "after");

  const candidates = [...changes.values()]
    .map((change) => ({ ...change, delta: change.after - change.before }))
    .filter((change) => change.delta !== 0n && !QUOTE_MINTS.has(change.mint));

  if (candidates.length === 0) return null;

  if (candidates.length > 1) {
    logger.debug(
      {
        signature: tx.signature,
        changedMints: candidates.map((candidate) => candidate.mint),
      },
      "Transaction ambiguë : plusieurs tokens non-quote ont changé",
    );
    return null;
  }

  const candidate = candidates[0];
  if (!candidate) return null;

  const isBuy = candidate.delta > 0n;
  const rawAmount = (isBuy ? candidate.delta : -candidate.delta).toString();
  const uiAmount = Number(rawAmount) / 10 ** candidate.decimals;

  if (!Number.isFinite(uiAmount)) {
    logger.warn(
      { signature: tx.signature, mint: candidate.mint },
      "Montant de token non représentable en nombre",
    );
    return null;
  }

  const dexProgramId = detectDexProgram(tx);

  return {
    signature: tx.signature,
    mint: candidate.mint,
    side: isBuy ? "buy" : "sell",
    amountIn: isBuy ? uiAmount : 0,
    amountOut: isBuy ? 0 : uiAmount,
    tokenAmountRaw: rawAmount,
    tokenDecimals: candidate.decimals,
    ...(dexProgramId ? { dexProgramId } : {}),
    ...(tx.blockTime == null ? {} : { timestamp: tx.blockTime * 1000 }),
  };
}
