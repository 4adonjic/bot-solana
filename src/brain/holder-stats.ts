import { Connection, PublicKey } from "@solana/web3.js";
import type { TokenSecuritySnapshot } from "./security.js";

const TOKEN_PROGRAM_IDS = [
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
] as const;

interface ParsedTokenAccount {
  account?: {
    data?: {
      parsed?: {
        type?: string;
        info?: {
          owner?: unknown;
          tokenAmount?: { amount?: unknown };
        };
      };
    };
  };
}

export interface HolderStats {
  holderCount: number;
  top10HolderPercent: number;
}

/** Aggregate token accounts by wallet owner, using raw integer amounts. */
export function calculateHolderStats(
  accounts: readonly unknown[],
  supplyRaw: string,
): HolderStats {
  if (!/^\d+$/.test(supplyRaw) || BigInt(supplyRaw) <= 0n) {
    throw new Error("Invalid or zero token supply");
  }

  const balancesByOwner = new Map<string, bigint>();

  for (const candidate of accounts) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const account = candidate as ParsedTokenAccount;
    const info = account.account?.data?.parsed?.info;
    if (!info || account.account?.data?.parsed?.type !== "account") continue;
    if (typeof info.owner !== "string" || typeof info.tokenAmount?.amount !== "string") continue;
    if (!/^\d+$/.test(info.tokenAmount.amount)) continue;

    const amount = BigInt(info.tokenAmount.amount);
    if (amount <= 0n) continue;
    balancesByOwner.set(info.owner, (balancesByOwner.get(info.owner) ?? 0n) + amount);
  }

  const sortedBalances = [...balancesByOwner.values()].sort((a, b) =>
    a > b ? -1 : a < b ? 1 : 0,
  );
  const top10Raw = sortedBalances.slice(0, 10).reduce((sum, amount) => sum + amount, 0n);
  const top10HolderPercent = Number((top10Raw * 1_000_000n) / BigInt(supplyRaw)) / 10_000;

  return {
    holderCount: balancesByOwner.size,
    top10HolderPercent: Math.min(100, top10HolderPercent),
  };
}

/**
 * Reads all parsed SPL Token and Token-2022 accounts for a mint, then
 * aggregates balances by wallet owner. RPC providers may limit this query;
 * on failure, callers must keep holder metrics unchecked.
 */
export async function fetchHolderStats(
  connection: Pick<Connection, "getParsedProgramAccounts" | "getTokenSupply">,
  mintAddress: string,
): Promise<Pick<TokenSecuritySnapshot, "holderCount" | "top10HolderPercent">> {
  const mint = new PublicKey(mintAddress);
  const supplyResponse = await connection.getTokenSupply(mint, "confirmed");
  const supplyRaw = supplyResponse.value.amount;

  if (!/^\d+$/.test(supplyRaw) || BigInt(supplyRaw) <= 0n) {
    throw new Error("Mint supply is unavailable or zero");
  }

  const accountGroups = await Promise.all(
    TOKEN_PROGRAM_IDS.map((programId) =>
      connection.getParsedProgramAccounts(new PublicKey(programId), {
        commitment: "confirmed",
        filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }],
      }),
    ),
  );

  const stats = calculateHolderStats(accountGroups.flat(), supplyRaw);
  return stats;
}
