import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateHolderStats } from "./holder-stats.js";

function tokenAccount(owner: string, amount: string): unknown {
  return {
    account: {
      data: {
        parsed: {
          type: "account",
          info: { owner, tokenAmount: { amount } },
        },
      },
    },
  };
}

test("aggregates multiple token accounts belonging to the same owner", () => {
  const stats = calculateHolderStats(
    [
      tokenAccount("wallet-a", "400"),
      tokenAccount("wallet-a", "100"),
      tokenAccount("wallet-b", "300"),
      tokenAccount("wallet-c", "200"),
    ],
    "1000",
  );

  assert.deepEqual(stats, { holderCount: 3, top10HolderPercent: 100 });
});

test("ignores zero balances and malformed accounts", () => {
  const stats = calculateHolderStats(
    [
      tokenAccount("wallet-a", "0"),
      tokenAccount("wallet-b", "250"),
      { account: { data: { parsed: { type: "mint", info: {} } } } },
      tokenAccount("wallet-c", "not-a-number"),
    ],
    "1000",
  );

  assert.deepEqual(stats, { holderCount: 1, top10HolderPercent: 25 });
});

test("rejects invalid or zero supply", () => {
  assert.throws(() => calculateHolderStats([], "0"), /supply/i);
  assert.throws(() => calculateHolderStats([], "bad"), /supply/i);
});
