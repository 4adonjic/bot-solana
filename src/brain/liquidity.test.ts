import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchTokenLiquidityUsd } from "./liquidity.js";

const mint = "MintAddress111111111111111111111111111111";

function mockFetch(payload: unknown, status = 200): typeof fetch {
  return async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
}

test("uses the deepest valid Solana pool, without summing pools", async () => {
  const result = await fetchTokenLiquidityUsd(
    mint,
    mockFetch([
      {
        chainId: "solana",
        baseToken: { address: mint },
        quoteToken: { address: "Quote111" },
        liquidity: { usd: 12_000 },
      },
      {
        chainId: "solana",
        baseToken: { address: "Quote222" },
        quoteToken: { address: mint },
        liquidity: { usd: 25_000 },
      },
      {
        chainId: "ethereum",
        baseToken: { address: mint },
        liquidity: { usd: 900_000 },
      },
      {
        chainId: "solana",
        baseToken: { address: "OtherMint" },
        liquidity: { usd: 500_000 },
      },
    ]),
  );

  assert.deepEqual(result, { liquidityUsd: 25_000 });
});

test("rejects missing or invalid liquidity data", async () => {
  await assert.rejects(
    fetchTokenLiquidityUsd(mint, mockFetch([])),
    /No valid Solana pool liquidity/i,
  );
  await assert.rejects(
    fetchTokenLiquidityUsd(
      mint,
      mockFetch([
        {
          chainId: "solana",
          baseToken: { address: mint },
          liquidity: { usd: "unknown" },
        },
      ]),
    ),
    /No valid Solana pool liquidity/i,
  );
});

test("reports API errors instead of treating them as zero liquidity", async () => {
  await assert.rejects(
    fetchTokenLiquidityUsd(mint, mockFetch({}, 429)),
    /HTTP 429/,
  );
});
