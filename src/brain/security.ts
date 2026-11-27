export type SecurityDecision = "allow" | "review" | "reject";

export interface TokenSecuritySnapshot {
  /** null means the authority is revoked; undefined means not checked. */
  mintAuthority?: string | null;
  /** null means the authority is revoked; undefined means not checked. */
  freezeAuthority?: string | null;
  /** Current pool liquidity in USD. Undefined means not checked. */
  liquidityUsd?: number;
  /** Combined ownership percentage of the ten largest holders. */
  top10HolderPercent?: number;
  /** Number of distinct token holders. */
  holderCount?: number;
}

export interface SecurityAssessment {
  decision: SecurityDecision;
  riskScore: number;
  reasons: string[];
  missingChecks: string[];
}

const LIMITS = {
  minimumLiquidityUsd: 20_000,
  lowLiquidityUsd: 20_000,
  highTop10Percent: 50,
  elevatedTop10Percent: 30,
  veryFewHolders: 50,
  fewHolders: 200,
} as const;

/**
 * Conservative, deterministic first-pass risk scoring.
 *
 * This function only evaluates supplied data. It does not fetch on-chain
 * information and must not be treated as proof that a token is safe.
 */
export function assessTokenSecurity(
  snapshot: TokenSecuritySnapshot,
): SecurityAssessment {
  let riskScore = 0;
  const reasons: string[] = [];
  const missingChecks: string[] = [];

  if (snapshot.mintAuthority === undefined) {
    missingChecks.push("mint authority");
  } else if (snapshot.mintAuthority !== null) {
    riskScore += 35;
    reasons.push("Mint authority is still active");
  }

  if (snapshot.freezeAuthority === undefined) {
    missingChecks.push("freeze authority");
  } else if (snapshot.freezeAuthority !== null) {
    riskScore += 25;
    reasons.push("Freeze authority is still active");
  }

  if (snapshot.liquidityUsd === undefined) {
    missingChecks.push("liquidity");
  } else if (!Number.isFinite(snapshot.liquidityUsd) || snapshot.liquidityUsd < 0) {
    missingChecks.push("valid liquidity value");
  } else if (snapshot.liquidityUsd < LIMITS.minimumLiquidityUsd) {
    riskScore += 25;
    reasons.push(`Liquidity is below $${LIMITS.minimumLiquidityUsd.toLocaleString("en-US")}`);
  } else if (snapshot.liquidityUsd < LIMITS.lowLiquidityUsd) {
    riskScore += 10;
    reasons.push(`Liquidity is below $${LIMITS.lowLiquidityUsd.toLocaleString("en-US")}`);
  }

  if (snapshot.top10HolderPercent === undefined) {
    missingChecks.push("top 10 holder concentration");
  } else if (
    !Number.isFinite(snapshot.top10HolderPercent) ||
    snapshot.top10HolderPercent < 0 ||
    snapshot.top10HolderPercent > 100
  ) {
    missingChecks.push("valid top 10 holder concentration");
  } else if (snapshot.top10HolderPercent > LIMITS.highTop10Percent) {
    riskScore += 25;
    reasons.push("Top 10 holders own more than 50% of supply");
  } else if (snapshot.top10HolderPercent > LIMITS.elevatedTop10Percent) {
    riskScore += 10;
    reasons.push("Top 10 holders own more than 30% of supply");
  }

  if (snapshot.holderCount === undefined) {
    missingChecks.push("holder count");
  } else if (!Number.isInteger(snapshot.holderCount) || snapshot.holderCount < 0) {
    missingChecks.push("valid holder count");
  } else if (snapshot.holderCount < LIMITS.veryFewHolders) {
    riskScore += 15;
    reasons.push("Fewer than 50 holders");
  } else if (snapshot.holderCount < LIMITS.fewHolders) {
    riskScore += 7;
    reasons.push("Fewer than 200 holders");
  }

  riskScore = Math.min(100, riskScore);

  const decision: SecurityDecision =
    riskScore >= 60
      ? "reject"
      : riskScore >= 25 || missingChecks.length > 0
        ? "review"
        : "allow";

  return { decision, riskScore, reasons, missingChecks };
}
