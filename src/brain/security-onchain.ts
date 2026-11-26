import { Connection, PublicKey } from "@solana/web3.js";
import type { TokenSecuritySnapshot } from "./security.js";

interface ParsedMintInfo {
  mintAuthority?: unknown;
  freezeAuthority?: unknown;
}

interface ParsedAccountDataLike {
  parsed?: {
    type?: string;
    info?: ParsedMintInfo;
  };
}

/**
 * Extracts mint/freeze authorities from parsed SPL Token account data.
 * A null authority means revoked; absent or malformed data stays unchecked.
 */
export function parseMintAuthorities(data: unknown): Partial<TokenSecuritySnapshot> {
  if (typeof data !== "object" || data === null || !("parsed" in data)) {
    return {};
  }

  const parsedData = data as ParsedAccountDataLike;
  if (parsedData.parsed?.type !== "mint" || !parsedData.parsed.info) {
    return {};
  }

  const info = parsedData.parsed.info;
  const snapshot: Partial<TokenSecuritySnapshot> = {};

  if (info.mintAuthority === null || typeof info.mintAuthority === "string") {
    snapshot.mintAuthority = info.mintAuthority;
  }

  if (info.freezeAuthority === null || typeof info.freezeAuthority === "string") {
    snapshot.freezeAuthority = info.freezeAuthority;
  }

  return snapshot;
}

/**
 * Reads the mint and freeze authorities from Solana RPC.
 * Other security metrics remain unchecked until their data sources are added.
 */
export async function fetchMintAuthorities(
  connection: Pick<Connection, "getParsedAccountInfo">,
  mintAddress: string,
): Promise<Partial<TokenSecuritySnapshot>> {
  const mint = new PublicKey(mintAddress);
  const account = await connection.getParsedAccountInfo(mint, "confirmed");

  if (!account.value) {
    throw new Error("Mint account not found on Solana");
  }

  const snapshot = parseMintAuthorities(account.value.data);
  if (snapshot.mintAuthority === undefined || snapshot.freezeAuthority === undefined) {
    throw new Error("Mint account data is not a recognized parsed SPL Token mint");
  }

  return snapshot;
}
