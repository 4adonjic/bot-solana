import type { ParsedTrade, ParsedTransaction, TokenBalance } from "./types.js";
import { detectDexProgram } from "./dex.js";

const QUOTE_DECIMALS: Record<string, number> = {
  "So11111111111111111111111111111111111111112": 9,
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": 6,
};
const SOL_MINT_LABEL = "SOL";

interface BalanceChange {
  wallet: string;
  mint: string;
  decimals: number;
  before: bigint;
  after: bigint;
}

/**
 * Extracts unambiguous token balance changes for every owner represented in
 * the transaction. Quote amounts are attached only when their direction is
 * consistent with the acquired/sold token. Native SOL is explicitly marked
 * as an estimate because rent and unrelated SOL transfers can affect it.
 */
export function parseWalletTradeChanges(tx: ParsedTransaction): ParsedTrade[] {
  const changes = new Map<string, BalanceChange>();

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

  const byWallet = new Map<string, BalanceChange[]>();
  for (const change of changes.values()) {
    const delta = change.after - change.before;
    if (delta === 0n || Object.hasOwn(QUOTE_DECIMALS, change.mint)) continue;
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

    const trade: ParsedTrade = {
      wallet,
      signature: tx.signature,
      mint: change.mint,
      side: isBuy ? "buy" : "sell",
      amountIn: isBuy ? uiAmount : 0,
      amountOut: isBuy ? 0 : uiAmount,
      tokenAmountRaw: rawAmount,
      tokenDecimals: change.decimals,
      tokenBalanceBeforeRaw: change.before.toString(),
      tokenBalanceAfterRaw: change.after.toString(),
      ...(dexProgramId ? { dexProgramId } : {}),
      ...(tx.blockTime == null ? {} : { timestamp: tx.blockTime * 1000 }),
    };

    const quoteChanges = [...changes.values()].filter(
      (candidate) =>
        candidate.wallet === wallet &&
        Object.hasOwn(QUOTE_DECIMALS, candidate.mint) &&
        candidate.after !== candidate.before,
    );

    if (quoteChanges.length === 1) {
      const quote = quoteChanges[0];
      if (quote) {
        const quoteDelta = quote.after - quote.before;
        if ((isBuy && quoteDelta < 0n) || (!isBuy && quoteDelta > 0n)) {
          trade.quoteAmountRaw = (quoteDelta < 0n ? -quoteDelta : quoteDelta).toString();
          trade.quoteMint = quote.mint;
          trade.quoteDecimals = quote.decimals;
          trade.quoteSource = "token_balance";
          trade.quoteAmountIsEstimate = false;
        }
      }
    } else if (quoteChanges.length === 0) {
      const native = tx.nativeBalanceChanges?.find((item) => item.wallet === wallet);
      if (native) {
        let nativeDelta = BigInt(native.postLamports) - BigInt(native.preLamports);
        if (wallet === tx.feePayer && tx.feeLamports) {
          nativeDelta += BigInt(tx.feeLamports);
        }
        if ((isBuy && nativeDelta < 0n) || (!isBuy && nativeDelta > 0n)) {
          trade.quoteAmountRaw = (nativeDelta < 0n ? -nativeDelta : nativeDelta).toString();
          trade.quoteMint = SOL_MINT_LABEL;
          trade.quoteDecimals = 9;
          trade.quoteSource = "native_balance_estimate";
          trade.quoteAmountIsEstimate = true;
        }
      }
    }

    trades.push(trade);
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
