import type { Connection } from "@solana/web3.js";
import {
  assessTokenSecurity,
  type SecurityAssessment,
  type TokenSecuritySnapshot,
} from "./security.js";
import { fetchMintAuthorities } from "./security-onchain.js";
import { fetchHolderStats } from "./holder-stats.js";
import { fetchTokenLiquidityUsd } from "./liquidity.js";

export interface TokenSecurityReport {
  mint: string;
  snapshot: TokenSecuritySnapshot;
  assessment: SecurityAssessment;
  sourceErrors: string[];
}

/**
 * Collects the three available sources independently. A failed source stays
 * missing in the snapshot, which makes the scorer return review rather than
 * silently treating unavailable data as safe.
 */
export async function analyzeTokenSecurity(
  connection: Connection,
  mint: string,
): Promise<TokenSecurityReport> {
  const [authorities, holders, liquidity] = await Promise.allSettled([
    fetchMintAuthorities(connection, mint),
    fetchHolderStats(connection, mint),
    fetchTokenLiquidityUsd(mint),
  ]);

  const snapshot: TokenSecuritySnapshot = {};
  const sourceErrors: string[] = [];

  if (authorities.status === "fulfilled") {
    Object.assign(snapshot, authorities.value);
  } else {
    sourceErrors.push(`Authorities: ${errorMessage(authorities.reason)}`);
  }

  if (holders.status === "fulfilled") {
    Object.assign(snapshot, holders.value);
  } else {
    sourceErrors.push(`Holders: ${errorMessage(holders.reason)}`);
  }

  if (liquidity.status === "fulfilled") {
    Object.assign(snapshot, liquidity.value);
  } else {
    sourceErrors.push(`Liquidity: ${errorMessage(liquidity.reason)}`);
  }

  return {
    mint,
    snapshot,
    assessment: assessTokenSecurity(snapshot),
    sourceErrors,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
