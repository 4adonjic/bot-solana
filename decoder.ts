import { Connection, ConfirmedSignatureInfo, PublicKey } from "@solana/web3.js";
import { config } from "../config/env.js";
import { logger } from "../core/logger.js";
import { ParsedTrade, ParsedTransaction, Side, TokenBalance } from "./types.js";

// Known DEX program IDs (base58) for later DEX-specific parsing
const DEX_PROGRAM_IDS = {
  RAYDIUM_AMM: "675kPX9MHTjS2zt1qfr1NiuGePZB1GyzhjFuytX5k2Ud",
  RAYDIUM_CLMM: "CAMMCzo55L8kZRZ2JBfzPk5Ycg8pt4BjyVJeXO1ZLVjM",
  PUMP_FUN: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  JUPITER_V6: "JUP6LkbZBsp1EHb8ZBBkfCev5EwZ4f3iR1r7Z1yQz4T",
  METEORA: "MeteoraDydnn66p5yUa4Z8x7J3nE6vSgBQGZQa4xzV1T",
} as const;

/**
 * Decode a raw transaction into a ParsedTrade by comparing pre/post token balances
 * for the target wallet(s). Returns null if no trade is detected.
 */
export class TransactionDecoder {
  private connection: Connection;
  private targetWallets: readonly string[];

  constructor(options: { connection?: Connection; targetWallets?: readonly string[] } = {}) {
    this.connection = options.connection ?? new Connection(config.rpcHttpUrl, "confirmed");
    this.targetWallets = options.targetWallets ?? config.targetWallets;
  }

  /**
   * Fetch and decode a transaction by signature.
   * Returns a ParsedTrade if the target wallet bought or sold a token, null otherwise.
   */
  async decode(signature: string): Promise<ParsedTrade | null> {
    try {
      const tx = await this.connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) {
        logger.debug({ signature }, "Transaction introuvable (trop ancienne ou pas encore indexee)");
        return null;
      }

      const parsedTx = this._extractParsedTransaction(signature, tx);
      return this._parseTrade(parsedTx);
    } catch (error: unknown) {
      logger.error({ signature, error: (error as Error).message }, "Erreur lors du decodage de la transaction");
      return null;
    }
  }

  /** Convert web3.js transaction object into our normalized ParsedTransaction */
  private _extractParsedTransaction(signature: string, tx: any): ParsedTransaction {
    const meta = tx.meta ?? {};
    const blockTime = tx.blockTime ?? undefined;

    const preTokenBalances: TokenBalance[] = (meta.preTokenBalances ?? []).map((b: any) => ({
      mint: b.mint,
      owner: b.owner,
      programId: b.programId,
      uiTokenAmount: {
        amount: b.uiTokenAmount.amount,
        decimals: b.uiTokenAmount.decimals,
        uiAmount: b.uiTokenAmount.uiAmount ?? 0,
      },
    }));

    const postTokenBalances: TokenBalance[] = (meta.postTokenBalances ?? []).map((b: any) => ({
      mint: b.mint,
      owner: b.owner,
      programId: b.programId,
      uiTokenAmount: {
        amount: b.uiTokenAmount.amount,
        decimals: b.uiTokenAmount.decimals,
        uiAmount: b.uiTokenAmount.uiAmount ?? 0,
      },
    }));

    // Build a flattened list of all instructions (top-level + inner) so DEX detection
    // can find swap instructions even when they are nested inside aggregator calls.
    const accountKeys: string[] = (tx.transaction.message.accountKeys ?? []).map((k: any) =>
      typeof k === "string" ? k : (k.pubkey ?? ""),
    );

    const toInstruction = (ix: any) => {
      const programId =
        typeof ix.programId === "string"
          ? ix.programId
          : (ix.programId?.toBase58?.() ?? "");

      const accounts = (ix.accounts ?? []).map((a: any) => {
        const idx = typeof a === "number" ? a : -1;
        const pubkey =
          idx >= 0 && idx < accountKeys.length
            ? accountKeys[idx]
            : (a?.pubkey ?? "");
        return {
          pubkey,
          source: a?.isSigner ?? false,
          writable: a?.isWritable ?? false,
        };
      });

      return {
        programId,
        accounts,
        data: new Uint8Array(),
      };
    };

    const topLevel = (tx.transaction.message.instructions ?? []).map(toInstruction);
    const innerGroups = (meta.innerInstructions ?? []).flatMap(
      (group: any) => group.instructions ?? [],
    );
    const inner = innerGroups.map(toInstruction);

    return {
      signature,
      blockTime,
      preTokenBalances,
      postTokenBalances,
      innerInstructions: [...topLevel, ...inner],
    };
  }

  /** Core parsing: compare pre/post balances per target wallet to detect buy/sell */
  private _parseTrade(tx: ParsedTransaction): ParsedTrade | null {
    // Group post balances by mint + owner for quick lookup
    const postByKey = new Map<string, TokenBalance>();
    for (const b of tx.postTokenBalances) {
      postByKey.set(`${b.owner}|${b.mint}`, b);
    }

    // Detect balance changes for target wallets
    for (const pre of tx.preTokenBalances) {
      if (!this.targetWallets.includes(pre.owner)) {
        continue;
      }

      const post = postByKey.get(`${pre.owner}|${pre.mint}`);
      if (!post) {
        // Token balance disappeared entirely (sold all) -> treat as zero
        const amountOut = Number(pre.uiTokenAmount.uiAmount);
        if (amountOut > 0) {
          return this._buildTrade(tx, pre.mint, "sell", 0, amountOut);
        }
        continue;
      }

      const preAmount = Number(pre.uiTokenAmount.uiAmount);
      const postAmount = Number(post.uiTokenAmount.uiAmount);
      const diff = postAmount - preAmount;

      if (diff > 0) {
        // Balance increased: wallet bought this token
        return this._buildTrade(tx, pre.mint, "buy", diff, 0);
      }
      if (diff < 0) {
        // Balance decreased: wallet sold this token
        return this._buildTrade(tx, pre.mint, "sell", 0, -diff);
      }
    }

    return null;
  }

  private _buildTrade(
    tx: ParsedTransaction,
    mint: string,
    side: Side,
    amountIn: number,
    amountOut: number,
  ): ParsedTrade {
    const dexProgramId = this._detectDexProgram(tx);
    const timestamp = tx.blockTime != null ? tx.blockTime * 1000 : 0;

    return {
      signature: tx.signature,
      mint,
      side,
      amountIn,
      amountOut,
      dexProgramId,
      timestamp,
    } as ParsedTrade;
  }

  /** Heuristic: detect which DEX program was involved by scanning inner instructions */
  private _detectDexProgram(tx: ParsedTransaction): string | undefined {
    const knownIds = Object.values(DEX_PROGRAM_IDS) as string[];
    for (const ix of tx.innerInstructions) {
      if (knownIds.includes(ix.programId)) {
        return ix.programId;
      }
    }
    return undefined;
  }
}

export const defaultDecoder = new TransactionDecoder();