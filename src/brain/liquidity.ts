import type { TokenSecuritySnapshot } from "./security.js";

interface DexScreenerPair {
  chainId?: unknown;
  pairAddress?: unknown;
  baseToken?: { address?: unknown };
  quoteToken?: { address?: unknown };
  liquidity?: { usd?: unknown } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parsePairs(payload: unknown): DexScreenerPair[] {
  if (!Array.isArray(payload)) return [];
  return payload.filter(isRecord) as DexScreenerPair[];
}

/**
 * Fetches the largest reported USD liquidity among a token's Solana pools.
 * This deliberately uses the deepest single pool rather than summing pools,
 * which could double-count liquidity or include unrelated quote assets.
 *
 * Throws on unavailable/invalid data: callers must leave liquidity unchecked,
 * never interpret an API failure as zero liquidity or as a safe token.
 */
export async function fetchTokenLiquidityUsd(
  mintAddress: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Pick<TokenSecuritySnapshot, "liquidityUsd">> {
  if (!mintAddress.trim()) {
    throw new Error("Token mint address is required");
  }

  const url = `https://api.dexscreener.com/token-pairs/v1/solana/${encodeURIComponent(mintAddress)}`;
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`DEX Screener request failed with HTTP ${response.status}`);
  }

  const pairs = parsePairs(await response.json());
  const validLiquidity = pairs
    .filter((pair) => {
      const isSolana = pair.chainId === "solana";
      const containsMint =
        pair.baseToken?.address === mintAddress ||
        pair.quoteToken?.address === mintAddress;
      return isSolana && containsMint;
    })
    .map((pair) => pair.liquidity?.usd)
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value) && value >= 0,
    );

  if (validLiquidity.length === 0) {
    throw new Error("No valid Solana pool liquidity data found for this mint");
  }

  return { liquidityUsd: Math.max(...validLiquidity) };
}
