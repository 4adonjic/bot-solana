import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTokenBalanceChanges, parseWalletTradeChanges } from "./balance-parser.js";
import type { ParsedTransaction, TokenBalance } from "./types.js";

const wallet = "wallet-A";
const tokenMint = "TokenMintA";
const wsolMint = "So11111111111111111111111111111111111111112";
const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function balance(mint: string, amount: string, decimals = 6, owner = wallet): TokenBalance {
  return {
    mint, owner, programId: "TokenProgram",
    uiTokenAmount: { amount, decimals, uiAmount: Number(amount) / 10 ** decimals },
  };
}

function transaction(
  preTokenBalances: TokenBalance[] = [],
  postTokenBalances: TokenBalance[] = [],
  extras: Partial<ParsedTransaction> = {},
): ParsedTransaction {
  return {
    signature: "test-signature",
    blockTime: 1_700_000_000,
    preTokenBalances,
    postTokenBalances,
    innerInstructions: [],
    ...extras,
  };
}

test("detects a buy when a new token account appears", () => {
  const trade = parseTokenBalanceChanges(transaction([], [balance(tokenMint, "2500000")]), [wallet]);
  assert.ok(trade);
  assert.equal(trade.wallet, wallet);
  assert.equal(trade.side, "buy");
  assert.equal(trade.mint, tokenMint);
  assert.equal(trade.tokenAmountRaw, "2500000");
  assert.equal(trade.amountIn, 2.5);
});

test("detects a full sale when the token account disappears", () => {
  const trade = parseTokenBalanceChanges(transaction([balance(tokenMint, "1500000")], []), [wallet]);
  assert.ok(trade);
  assert.equal(trade.side, "sell");
  assert.equal(trade.tokenAmountRaw, "1500000");
  assert.equal(trade.amountOut, 1.5);
});

test("aggregates several token accounts for the same mint", () => {
  const trade = parseTokenBalanceChanges(transaction(
    [balance(tokenMint, "1000000"), balance(tokenMint, "500000")],
    [balance(tokenMint, "800000"), balance(tokenMint, "900000")],
  ), [wallet]);
  assert.ok(trade);
  assert.equal(trade.side, "buy");
  assert.equal(trade.tokenAmountRaw, "200000");
});

test("captures WSOL quote amount in raw lamports for a buy", () => {
  const trade = parseTokenBalanceChanges(transaction(
    [balance(wsolMint, "1000000000", 9)],
    [balance(wsolMint, "750000000", 9), balance(tokenMint, "3000000")],
  ), [wallet]);
  assert.ok(trade);
  assert.equal(trade.quoteAmountRaw, "250000000");
  assert.equal(trade.quoteMint, wsolMint);
  assert.equal(trade.quoteDecimals, 9);
  assert.equal(trade.quoteSource, "token_balance");
  assert.equal(trade.quoteAmountIsEstimate, false);
});

test("captures USDC quote amount for a sale", () => {
  const trade = parseTokenBalanceChanges(transaction(
    [balance(tokenMint, "3000000"), balance(usdcMint, "1000000", 6)],
    [balance(usdcMint, "2500000", 6)],
  ), [wallet]);
  assert.ok(trade);
  assert.equal(trade.side, "sell");
  assert.equal(trade.quoteAmountRaw, "1500000");
  assert.equal(trade.quoteMint, usdcMint);
  assert.equal(trade.quoteSource, "token_balance");
});

test("estimates SOL quote amount after excluding the transaction fee", () => {
  const trade = parseTokenBalanceChanges(transaction(
    [],
    [balance(tokenMint, "2000000")],
    {
      nativeBalanceChanges: [{ wallet, preLamports: "5000000000", postLamports: "3999000000" }],
      feeLamports: "5000",
      feePayer: wallet,
    },
  ), [wallet]);
  assert.ok(trade);
  assert.equal(trade.quoteAmountRaw, "1000000000");
  assert.equal(trade.quoteMint, "SOL");
  assert.equal(trade.quoteSource, "native_balance_estimate");
  assert.equal(trade.quoteAmountIsEstimate, true);
});

test("does not attach a quote when its direction conflicts with the token movement", () => {
  const trade = parseTokenBalanceChanges(transaction(
    [balance(wsolMint, "500000000", 9)],
    [balance(wsolMint, "750000000", 9), balance(tokenMint, "1000000")],
  ), [wallet]);
  assert.ok(trade);
  assert.equal(trade.quoteAmountRaw, undefined);
});

test("does not guess when multiple non-quote tokens changed", () => {
  const trade = parseTokenBalanceChanges(transaction(
    [balance("TokenMintA", "1000000")],
    [balance("TokenMintB", "2000000")],
  ), [wallet]);
  assert.equal(trade, null);
});

test("preserves the exact raw amount above JavaScript's safe integer range", () => {
  const rawAmount = "900719925474099312345";
  const trade = parseTokenBalanceChanges(transaction([], [balance(tokenMint, rawAmount, 9)]), [wallet]);
  assert.ok(trade);
  assert.equal(trade.tokenAmountRaw, rawAmount);
});

test("ignores balance changes belonging to wallets not being monitored", () => {
  const trade = parseTokenBalanceChanges(transaction([], [balance(tokenMint, "5000000", 6, "another-wallet")]), [wallet]);
  assert.equal(trade, null);
});

test("keeps the transaction timestamp when it is available", () => {
  const trade = parseTokenBalanceChanges(transaction([], [balance(tokenMint, "1000000")]), [wallet]);
  assert.ok(trade);
  assert.equal(trade.timestamp, 1_700_000_000_000);
});

test("extracts unambiguous trades for multiple wallets in one transaction", () => {
  const trades = parseWalletTradeChanges(transaction(
    [balance(tokenMint, "1000000", 6, "wallet-A")],
    [balance(tokenMint, "2000000", 6, "wallet-A"), balance("TokenMintB", "5000000", 6, "wallet-B")],
  ));
  assert.equal(trades.length, 2);
  assert.deepEqual(trades.map(({ wallet: owner, mint, side }) => ({ wallet: owner, mint, side })), [
    { wallet: "wallet-A", mint: tokenMint, side: "buy" },
    { wallet: "wallet-B", mint: "TokenMintB", side: "buy" },
  ]);
});

test("skips only the ambiguous wallet and keeps other wallet candidates", () => {
  const trades = parseWalletTradeChanges(transaction([], [
    balance("TokenMintA", "1000000", 6, "ambiguous-wallet"),
    balance("TokenMintB", "2000000", 6, "ambiguous-wallet"),
    balance(tokenMint, "3000000", 6, "clear-wallet"),
  ]));
  assert.equal(trades.length, 1);
  assert.equal(trades[0]?.wallet, "clear-wallet");
});
