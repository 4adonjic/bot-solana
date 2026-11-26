import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTokenBalanceChanges } from "./decoder.js";
import type { ParsedTransaction, TokenBalance } from "./types.js";

const wallet = "wallet-A";
const tokenMint = "TokenMintA";
const wsolMint = "So11111111111111111111111111111111111111112";
const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function balance(
  mint: string,
  amount: string,
  decimals = 6,
  owner = wallet,
): TokenBalance {
  return {
    mint,
    owner,
    programId: "TokenProgram",
    uiTokenAmount: {
      amount,
      decimals,
      uiAmount: Number(amount) / 10 ** decimals,
    },
  };
}

function transaction(
  preTokenBalances: TokenBalance[] = [],
  postTokenBalances: TokenBalance[] = [],
): ParsedTransaction {
  return {
    signature: "test-signature",
    blockTime: 1_700_000_000,
    preTokenBalances,
    postTokenBalances,
    innerInstructions: [],
  };
}

test("detects a buy when a new token account appears", () => {
  const trade = parseTokenBalanceChanges(
    transaction([], [balance(tokenMint, "2500000")]),
    [wallet],
  );

  assert.ok(trade);
  assert.equal(trade.side, "buy");
  assert.equal(trade.mint, tokenMint);
  assert.equal(trade.tokenAmountRaw, "2500000");
  assert.equal(trade.amountIn, 2.5);
});

test("detects a full sale when the token account disappears", () => {
  const trade = parseTokenBalanceChanges(
    transaction([balance(tokenMint, "1500000")], []),
    [wallet],
  );

  assert.ok(trade);
  assert.equal(trade.side, "sell");
  assert.equal(trade.tokenAmountRaw, "1500000");
  assert.equal(trade.amountOut, 1.5);
});

test("aggregates several token accounts for the same mint", () => {
  const trade = parseTokenBalanceChanges(
    transaction(
      [balance(tokenMint, "1000000"), balance(tokenMint, "500000")],
      [balance(tokenMint, "800000"), balance(tokenMint, "900000")],
    ),
    [wallet],
  );

  assert.ok(trade);
  assert.equal(trade.side, "buy");
  assert.equal(trade.tokenAmountRaw, "200000");
});

test("ignores quote-token movements when identifying the acquired token", () => {
  const trade = parseTokenBalanceChanges(
    transaction(
      [balance(wsolMint, "1000000000", 9)],
      [balance(wsolMint, "500000000", 9), balance(tokenMint, "3000000")],
    ),
    [wallet],
  );

  assert.ok(trade);
  assert.equal(trade.side, "buy");
  assert.equal(trade.mint, tokenMint);
});

test("does not guess when multiple non-quote tokens changed", () => {
  const trade = parseTokenBalanceChanges(
    transaction(
      [balance("TokenMintA", "1000000")],
      [balance("TokenMintB", "2000000")],
    ),
    [wallet],
  );

  assert.equal(trade, null);
});

test("preserves the exact raw amount above JavaScript's safe integer range", () => {
  const rawAmount = "900719925474099312345";
  const trade = parseTokenBalanceChanges(
    transaction([], [balance(tokenMint, rawAmount, 9)]),
    [wallet],
  );

  assert.ok(trade);
  assert.equal(trade.tokenAmountRaw, rawAmount);
});

test("ignores balance changes belonging to wallets not being monitored", () => {
  const trade = parseTokenBalanceChanges(
    transaction([], [balance(tokenMint, "5000000", 6, "another-wallet")]),
    [wallet],
  );

  assert.equal(trade, null);
});

test("keeps the transaction timestamp when it is available", () => {
  const trade = parseTokenBalanceChanges(
    transaction([], [balance(tokenMint, "1000000")]),
    [wallet],
  );

  assert.ok(trade);
  assert.equal(trade.timestamp, 1_700_000_000_000);
});
