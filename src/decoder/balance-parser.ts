import type { ParsedTrade, ParsedTransaction, TokenBalance } from "./types.js";
import { detectDexProgram } from "./dex.js";

const QUOTE_MINTS = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
]);

/**
 * Extracts unambiguous token balance changes for every owner represented in
 * the transaction. This is the foundation for discovering wallets without a
 * preconfigured allowlist; it does not itself decide whether a wallet is good.
 */
export function parseWalletTradeChanges(tx: ParsedTransaction): ParsedTrade[] {
  const changes = new Map<
    string,
    {
      wallet: string;
      mint: string;
      decimals: number;
      before: bigint;
      after: bigint;
    }
  >();

  const addBalances = (balances: TokenBalance[], side: "before" | "after") => {
    for (const balance of balances) {
      const key = `${balance.owner}|${balance.mint}`;
      const current = changes.get(key) ?? {
        wallet: balance.owner,
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

  const byWallet = new Map<string, typeof changes extends Map<string, infer V> ? V[] : never>();
  for (const change of changes.values()) {
    const delta = change.after - change.before;
    if (delta === 0n || QUOTE_MINTS.has(change.mint)) continue;
    const walletChanges = byWallet.get(change.wallet) ?? [];
    walletChanges.push(change);
    byWallet.set(change.wallet, walletChanges);
  }

  const dexProgramId = detectDexProgram(tx);
  const trades: ParsedTrade[] = [];

  for (const [wallet, walletChanges] of byWallet) {
    // A wallet changing multiple non-quote mints is ambiguous; do not guess.
    if (walletChanges.length !== 1) continue;

    const change = walletChanges[0];
    if (!change) continue;

    const delta = change.after - change.before;
    const isBuy = delta > 0n;
    const rawAmount = (isBuy ? delta : -delta).toString();
    const uiAmount = Number(rawAmount) / 10 ** change.decimals;
    if (!Number.isFinite(uiAmount)) continue;

    trades.push({
      wallet,
      signature: tx.signature,
      mint: change.mint,
      side: isBuy ? "buy" : "sell",
      amountIn: isBuy ? uiAmount : 0,
      amountOut: isBuy ? 0 : uiAmount,
      tokenAmountRaw: rawAmount,
      tokenDecimals: change.decimals,
      ...(dexProgramId ? { dexProgramId } : {}),
      ...(tx.blockTime == null ? {} : { timestamp: tx.blockTime * 1000 }),
    });
  }

  return trades;
}

/**
 * Compatibility wrapper for the manually configured radar: it returns a
 * trade only when exactly one monitored wallet has an unambiguous change.
 */
export function parseTokenBalanceChanges(
  tx: ParsedTransaction,
  targetWallets: readonly string[],
): ParsedTrade | null {
  const allowed = new Set(targetWallets);
  const trades = parseWalletTradeChanges(tx).filter((trade) => allowed.has(trade.wallet));
  return trades.length === 1 ? trades[0] ?? null : null;
}
