import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PaperTradingEngine, type PaperQuoteAsset } from "../src/brain/paper-trading.js";
import type { PerformanceTrade } from "../src/brain/wallet-performance.js";

// Entirely synthetic inputs: no RPC, wallet, signing, or real transaction.
const quoteMint = "DEMO_USDC_MINT";
const tokenMint = "DEMO_TOKEN_MINT";
const leader = "DEMO_LEADER_WALLET";
const initialBalance = 100_000_000n; // 100.00 USDC
const asset: PaperQuoteAsset = {
  mint: quoteMint,
  decimals: 6,
  initialBalanceRaw: initialBalance.toString(),
  buySizeRaw: "10000000", // 10.00 USDC per simulated buy
};

function trade(
  side: "buy" | "sell",
  signature: string,
  tokenAmountRaw: string,
  quoteAmountRaw: string,
  tokenBalanceBeforeRaw?: string,
  tokenBalanceAfterRaw?: string,
): PerformanceTrade {
  return {
    wallet: leader,
    signature,
    mint: tokenMint,
    side,
    tokenAmountRaw,
    ...(tokenBalanceBeforeRaw === undefined ? {} : { tokenBalanceBeforeRaw }),
    ...(tokenBalanceAfterRaw === undefined ? {} : { tokenBalanceAfterRaw }),
    quoteAmountRaw,
    quoteMint,
    quoteDecimals: 6,
    quoteSource: "token_balance",
    quoteAmountIsEstimate: false,
    observedAt: side === "buy" ? "2026-01-01T12:00:00.000Z" : "2026-01-01T12:01:00.000Z",
  };
}

function usdc(raw: string | bigint): string {
  return (Number(raw) / 1_000_000).toFixed(4) + " USDC";
}

const directory = await mkdtemp(join(tmpdir(), "solana-paper-demo-"));
try {
  const engine = new PaperTradingEngine({
    filePath: join(directory, "paper-state.json"),
    quoteAssets: [asset],
    slippageBps: 50,
    feeBps: 10,
  });
  await engine.init();

  console.log("=== SOLANA BOT — PAPER TRADING DEMO ===");
  console.log("Mode: 100% fictif | Aucun RPC | Aucune clé privée | Aucune transaction envoyée");
  console.log("Solde initial:", usdc(initialBalance));
  console.log("\n[1/2] Le wallet fictif achète 1 000 tokens pour 5 USDC.");
  const buy = await engine.processTrade(trade("buy", "demo-buy-signature", "1000", "5000000"));
  assert.equal(buy.executed, true, "La simulation d'achat doit réussir.");
  if (!buy.executed) throw new Error(buy.reason);
  console.log("Achat simulé:", buy.fill.tokenAmountRaw, "tokens");
  console.log("Budget:", usdc(buy.fill.quoteAmountRaw), "| Frais:", usdc(buy.fill.feeQuoteRaw));
  console.log("Solde après achat:", usdc(buy.balanceRaw));

  console.log("\n[2/2] Le wallet fictif revend 250 tokens sur ses 1 000 tokens (25%) pour 1,5 USDC.");
  const sell = await engine.processTrade(trade("sell", "demo-sell-signature", "250", "1500000", "1000", "750"));
  assert.equal(sell.executed, true, "La simulation de vente doit réussir.");
  if (!sell.executed) throw new Error(sell.reason);
  console.log("Vente simulée:", sell.fill.tokenAmountRaw, "tokens");
  console.log("Produit net:", usdc(sell.fill.quoteAmountRaw), "| Frais:", usdc(sell.fill.feeQuoteRaw));

  const snapshot = engine.snapshot();
  assert.equal(snapshot.positions.length, 1, "La vente partielle doit laisser une position ouverte.");
  assert.equal(snapshot.positions[0]?.tokenAmountRaw, "1491", "25% de la position copiée doit être vendue.");
  assert.equal(snapshot.fills.length, 2, "Deux exécutions simulées sont attendues.");
  const finalBalance = BigInt(snapshot.balances[quoteMint] ?? "0");
  const pnl = finalBalance - initialBalance;
  console.log("\n=== BILAN ===");
  console.log("Solde final:", usdc(finalBalance));
  console.log("Résultat simulé:", (pnl >= 0n ? "+" : "") + usdc(pnl));
  console.log("Tokens restants:", snapshot.positions[0]?.tokenAmountRaw ?? "0");
  console.log("Positions ouvertes:", snapshot.positions.length);
  console.log("Exécutions simulées:", snapshot.fills.length);
  console.log("Assertions: OK");
  console.log("\nNote: prix source simplifié (pas de cotation indépendante au moment de la copie), frais réseau non inclus.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
