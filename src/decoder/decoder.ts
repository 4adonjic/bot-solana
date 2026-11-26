import {
  Connection,
  PublicKey,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { config } from "../config/env.js";
import { logger } from "../core/logger.js";
import { detectDexProgram } from "./dex.js";
import type { ParsedTrade, ParsedTransaction, TokenBalance } from "./types.js";

const QUOTE_MINTS = new Set([
  // Wrapped SOL and USDC. These are treated as quote assets when identifying
  // the token being bought or sold in a typical swap.
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
]);

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
 * amountIn/amountOut remain UI-unit numbers for compatibility with the rest
 * of the application; tokenAmountRaw is the exact value.
 */
export class TransactionDecoder {
  private readonly connection: Connection;
  private readonly targetWallets: readonly string[];

  constructor(options: {
    connection?: Connection;
    targetWallets?: readonly string[];
  } = {}) {
    this.connection =
      options.connection ?? new Connection(config.rpcHttpUrl, "confirmed");
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


/**
 * Pure balance-diff parser, exported so it can be tested without an RPC.
 * A single trade is returned only when exactly one non-quote mint changed.
 */
export function parseTokenBalanceChanges(
  tx: ParsedTransaction,
  targetWallets: readonly string[],
): ParsedTrade | null {
  const changes = new Map<
    string,
    { mint: string; decimals: number; before: bigint; after: bigint }
  >();

  const addBalances = (balances: TokenBalance[], side: "before" | "after") => {
    for (const balance of balances) {
      if (!targetWallets.includes(balance.owner)) continue;

      const key = `${balance.owner}|${balance.mint}`;
      const current = changes.get(key) ?? {
        mint: balance.mint,
        decimals: balance.uiTokenAmount.decimals,
        before: 0n,
        after: 0n,
      };

      current[side] += BigInt(balance.uiTokenAmount.amount);
      current.decimals = balance.uiTokenAmount.decimals;
      changes.set(key, current);
    }
  };

  addBalances(tx.preTokenBalances, "before");
  addBalances(tx.postTokenBalances, "after");

  const candidates = [...changes.values()]
    .map((change) => ({ ...change, delta: change.after - change.before }))
    .filter((change) => change.delta !== 0n && !QUOTE_MINTS.has(change.mint));

  if (candidates.length === 0) return null;

  if (candidates.length > 1) {
    logger.debug(
      {
        signature: tx.signature,
        changedMints: candidates.map((candidate) => candidate.mint),
      },
      "Transaction ambiguë : plusieurs tokens non-quote ont changé",
    );
    return null;
  }

  const candidate = candidates[0];
  if (!candidate) return null;

  const isBuy = candidate.delta > 0n;
  const rawAmount = (isBuy ? candidate.delta : -candidate.delta).toString();
  const uiAmount = Number(rawAmount) / 10 ** candidate.decimals;

  if (!Number.isFinite(uiAmount)) {
    logger.warn(
      { signature: tx.signature, mint: candidate.mint },
      "Montant de token non représentable en nombre",
    );
    return null;
  }

  const dexProgramId = detectDexProgram(tx);

  return {
    signature: tx.signature,
    mint: candidate.mint,
    side: isBuy ? "buy" : "sell",
    amountIn: isBuy ? uiAmount : 0,
    amountOut: isBuy ? 0 : uiAmount,
    tokenAmountRaw: rawAmount,
    tokenDecimals: candidate.decimals,
    ...(dexProgramId ? { dexProgramId } : {}),
    ...(tx.blockTime == null ? {} : { timestamp: tx.blockTime * 1000 }),
  };
}
