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
  /** Top-level and inner instructions, normalized to program IDs. */
  innerInstructions: Instruction[];
}

export interface ParsedTrade {
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
  dexProgramId?: string;
  timestamp?: number;
}
