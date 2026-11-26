export type Side = "buy" | "sell";

export interface TokenBalance {
  mint: string;
  owner: string;
  programId: string;
  uiTokenAmount: {
    /** Exact integer amount in the token's smallest unit. */
    amount: string;
    decimals: number;
    uiAmount: number;
  };
}

export interface NativeBalanceChange {
  wallet: string;
  preLamports: string;
  postLamports: string;
}

export interface InstructionAccountKeys {
  pubkey: string;
  source: boolean;
  writable: boolean;
}

export interface Instruction {
  programId: string;
  accounts: InstructionAccountKeys[];
  data: Uint8Array;
}

export interface ParsedTransaction {
  signature: string;
  blockTime?: number;
  preTokenBalances: TokenBalance[];
  postTokenBalances: TokenBalance[];
  /** Native SOL balances for transaction account keys, in lamports. */
  nativeBalanceChanges?: NativeBalanceChange[];
  /** Transaction fee in lamports, charged to feePayer. */
  feeLamports?: string;
  feePayer?: string;
  /** Top-level and inner instructions, normalized to program IDs. */
  innerInstructions: Instruction[];
}

export interface ParsedTrade {
  /** Wallet whose token balance changed. */
  wallet: string;
  signature: string;
  mint: string;
  side: Side;
  /** UI token amount received when buying. */
  amountIn: number;
  /** UI token amount spent when selling. */
  amountOut: number;
  /** Exact integer token amount; this is authoritative for precision. */
  tokenAmountRaw: string;
  tokenDecimals: number;
  /** Aggregated token balance represented in this transaction's metadata before and after it; may omit untouched token accounts. */
  tokenBalanceBeforeRaw?: string;
  tokenBalanceAfterRaw?: string;
  /** Quote spent (buy) or received (sell), in quoteMint's smallest unit. */
  quoteAmountRaw?: string;
  quoteMint?: string;
  quoteDecimals?: number;
  quoteSource?: "token_balance" | "native_balance_estimate";
  /** True when quote amount is inferred from net SOL balance change. */
  quoteAmountIsEstimate?: boolean;
  dexProgramId?: string;
  timestamp?: number;
}
