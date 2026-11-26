export type Side = "buy" | "sell";

export interface TokenBalance {
  mint: string;
  owner: string;
  programId: string;
  uiTokenAmount: {
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
  innerInstructions: Instruction[];
}

export interface ParsedTrade {
  signature: string;
  mint: string;
  side: Side;
  amountIn: number;
  amountOut: number;
  dexProgramId?: string;
  timestamp?: number;
}