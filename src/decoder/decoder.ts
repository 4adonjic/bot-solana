import {
  Connection,
  PublicKey,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { config } from "../config/env.js";
import { logger } from "../core/logger.js";
import { rateLimitedRpcFetch } from "../core/rpc-fetch.js";
import { parseTokenBalanceChanges, parseWalletTradeChanges } from "./balance-parser.js";
import type { ParsedTrade, ParsedTransaction, TokenBalance } from "./types.js";

interface RawTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: {
    amount: string;
    decimals: number;
    uiAmount: number | null;
  };
}

interface CompiledInstructionLike {
  programId?: PublicKey;
  programIdIndex?: number;
}

interface MessageLike {
  accountKeys?: PublicKey[];
  staticAccountKeys?: PublicKey[];
  instructions?: CompiledInstructionLike[];
  compiledInstructions?: CompiledInstructionLike[];
}

/**
 * Fetches a transaction and detects a target wallet's net token balance change.
 *
 * The raw integer token amount is kept as a string to avoid losing precision.
 * Quote amounts are also kept in raw units. Native SOL quote amounts are
 * estimates because rent and unrelated SOL transfers can affect wallet deltas.
 */
export class TransactionDecoder {
  private readonly connection: Connection;
  private readonly targetWallets: readonly string[];

  constructor(options: {
    connection?: Connection;
    targetWallets?: readonly string[];
  } = {}) {
    this.connection =
      options.connection ?? new Connection(config.rpcHttpUrl, { commitment: "confirmed", fetch: rateLimitedRpcFetch });
    this.targetWallets = [...new Set(options.targetWallets ?? config.targetWallets)];
  }

  async decode(signature: string): Promise<ParsedTrade | null> {
    try {
      const tx = await this.connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) {
        logger.debug(
          { signature },
          "Transaction introuvable (pas encore indexée ou indisponible)",
        );
        return null;
      }

      return this.parseTransaction(this.extractParsedTransaction(signature, tx));
    } catch (error: unknown) {
      logger.error(
        { signature, error: this.getErrorMessage(error) },
        "Erreur lors du décodage de la transaction",
      );
      return null;
    }
  }

  /**
   * Decodes all unambiguous wallet token-balance changes in a transaction.
   * Used by the opt-in DEX feed; this is candidate extraction, not proof of a swap.
   */
  async decodeWalletCandidates(signature: string): Promise<ParsedTrade[]> {
    try {
      const tx = await this.connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) return [];
      return parseWalletTradeChanges(this.extractParsedTransaction(signature, tx), { requireQuoteEvidence: true });
    } catch (error: unknown) {
      logger.error(
        { signature, error: this.getErrorMessage(error) },
        "Erreur lors de l'extraction des wallets candidats",
      );
      return [];
    }
  }

  private extractParsedTransaction(
    signature: string,
    tx: VersionedTransactionResponse,
  ): ParsedTransaction {
    const meta = tx.meta;
    if (!meta) {
      throw new Error("Métadonnées de transaction absentes");
    }

    const toTokenBalance = (balance: RawTokenBalance): TokenBalance | null => {
      // Without owner information we cannot safely attribute this token
      // account to one of the wallets being monitored.
      if (!balance.owner) return null;

      return {
        mint: balance.mint,
        owner: balance.owner,
        programId: balance.programId ?? "",
        uiTokenAmount: {
          amount: balance.uiTokenAmount.amount,
          decimals: balance.uiTokenAmount.decimals,
          uiAmount: balance.uiTokenAmount.uiAmount ?? 0,
        },
      };
    };

    const preTokenBalances = ((meta.preTokenBalances ?? []) as RawTokenBalance[])
      .map(toTokenBalance)
      .filter((balance): balance is TokenBalance => balance !== null);

    const postTokenBalances = ((meta.postTokenBalances ?? []) as RawTokenBalance[])
      .map(toTokenBalance)
      .filter((balance): balance is TokenBalance => balance !== null);

    const message = tx.transaction.message as unknown as MessageLike;
    const staticKeys = message.staticAccountKeys ?? message.accountKeys ?? [];
    const loadedKeys = [
      ...(meta.loadedAddresses?.writable ?? []),
      ...(meta.loadedAddresses?.readonly ?? []),
    ];
    const allKeys = [...staticKeys, ...loadedKeys];

    const nativeBalanceChanges = allKeys.flatMap((key, index) => {
      const preLamports = meta.preBalances[index];
      const postLamports = meta.postBalances[index];
      if (preLamports === undefined || postLamports === undefined) return [];
      return [{
        wallet: key.toBase58(),
        preLamports: String(preLamports),
        postLamports: String(postLamports),
      }];
    });

    const feePayer = staticKeys[0]?.toBase58();

    const resolveProgramId = (instruction: CompiledInstructionLike): string => {
      if (instruction.programId) return instruction.programId.toBase58();

      const index = instruction.programIdIndex;
      if (index === undefined || !allKeys[index]) return "";

      return allKeys[index].toBase58();
    };

    const topLevelInstructions = (
      message.compiledInstructions ?? message.instructions ?? []
    ).map((instruction) => ({
      programId: resolveProgramId(instruction),
      accounts: [],
      data: new Uint8Array(),
    }));

    const innerInstructions = (meta.innerInstructions ?? []).flatMap((group) =>
      group.instructions.map((instruction) => ({
        programId: resolveProgramId(instruction),
        accounts: [],
        data: new Uint8Array(),
      })),
    );

    return {
      signature,
      ...(tx.blockTime == null ? {} : { blockTime: tx.blockTime }),
      preTokenBalances,
      postTokenBalances,
      nativeBalanceChanges,
      feeLamports: String(meta.fee),
      ...(feePayer ? { feePayer } : {}),
      innerInstructions: [...topLevelInstructions, ...innerInstructions],
    };
  }

  private parseTransaction(tx: ParsedTransaction): ParsedTrade | null {
    return parseTokenBalanceChanges(tx, this.targetWallets);
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

export const defaultDecoder = new TransactionDecoder();
