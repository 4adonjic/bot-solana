import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type IntegritySeverity = "warning" | "error";
export interface IntegrityFinding {
  severity: IntegritySeverity;
  file: string;
  message: string;
}
export interface IntegrityReport {
  checkedFiles: number;
  findings: IntegrityFinding[];
}

const MIN_TIMESTAMP = Date.UTC(2009, 0, 1);
const MAX_TIMESTAMP_FUTURE_MS = 5 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isRawInteger(value: unknown, signed = false): value is string {
  return typeof value === "string" && (signed ? /^-?\d+$/ : /^\d+$/).test(value);
}
function validDate(value: unknown, now: number): boolean {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= MIN_TIMESTAMP && timestamp <= now + MAX_TIMESTAMP_FUTURE_MS;
}
function add(findings: IntegrityFinding[], severity: IntegritySeverity, file: string, message: string): void {
  findings.push({ severity, file, message });
}
async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Read-only checks for persisted bot state. This function never repairs or rewrites files. */
export async function auditDataDirectory(dataDirectory = "data", now = Date.now()): Promise<IntegrityReport> {
  const findings: IntegrityFinding[] = [];
  let checkedFiles = 0;
  const checkJson = async (name: string): Promise<unknown | null> => {
    try {
      const value = await readJson(join(dataDirectory, name));
      if (value !== null) checkedFiles++;
      return value;
    } catch (error) {
      add(findings, "error", name, error instanceof SyntaxError ? "JSON invalide" : `Lecture impossible: ${String(error)}`);
      return null;
    }
  };

  const tradePath = join(dataDirectory, "wallet-trades.jsonl");
  try {
    const content = await readFile(tradePath, "utf8");
    checkedFiles++;
    const seen = new Set<string>();
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] ?? "";
      if (!line.trim()) continue;
      let item: unknown;
      try { item = JSON.parse(line) as unknown; }
      catch { add(findings, "error", "wallet-trades.jsonl", `JSON invalide ligne ${index + 1}`); continue; }
      if (!isRecord(item)) {
        add(findings, "error", "wallet-trades.jsonl", `Enregistrement non objet ligne ${index + 1}`);
        continue;
      }
      const key = JSON.stringify([item.wallet, item.signature, item.mint]);
      if (seen.has(key)) add(findings, "warning", "wallet-trades.jsonl", `Doublon wallet/signature/mint ligne ${index + 1}`);
      seen.add(key);
      if (typeof item.wallet !== "string" || !item.wallet || typeof item.signature !== "string" || !item.signature ||
        typeof item.mint !== "string" || !item.mint || (item.side !== "buy" && item.side !== "sell") ||
        !isRawInteger(item.tokenAmountRaw) || !Number.isSafeInteger(item.slot) || (item.slot as number) < 0 ||
        !Number.isInteger(item.tokenDecimals) || (item.tokenDecimals as number) < 0 || (item.tokenDecimals as number) > 18) {
        add(findings, "error", "wallet-trades.jsonl", `Champs de trade invalides ligne ${index + 1}`);
      }
      if (!validDate(item.observedAt, now)) {
        add(findings, "warning", "wallet-trades.jsonl", `Date absente, invalide ou hors plage ligne ${index + 1}`);
      }
      if (item.quoteAmountRaw !== undefined && !isRawInteger(item.quoteAmountRaw)) {
        add(findings, "error", "wallet-trades.jsonl", `Montant quote invalide ligne ${index + 1}`);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      add(findings, "error", "wallet-trades.jsonl", `Lecture impossible: ${String(error)}`);
    }
  }

  const candidates = await checkJson("wallet-candidates.json");
  if (candidates !== null) {
    if (!isRecord(candidates) || candidates.version !== 1 || !isRecord(candidates.wallets)) {
      add(findings, "error", "wallet-candidates.json", "Format attendu version 1 avec objet wallets");
    } else {
      for (const [wallet, candidate] of Object.entries(candidates.wallets)) {
        if (!isRecord(candidate) || candidate.wallet !== wallet || !Number.isSafeInteger(candidate.observationCount) ||
          (candidate.observationCount as number) < 1 || !Array.isArray(candidate.recentObservations) ||
          !Array.isArray(candidate.recentKeys)) {
          add(findings, "error", "wallet-candidates.json", `Structure invalide pour ${wallet}`);
          continue;
        }
        if (!validDate(candidate.firstSeenAt, now) || !validDate(candidate.lastSeenAt, now)) {
          add(findings, "warning", "wallet-candidates.json", `Dates incohérentes pour ${wallet}`);
        }
        if (candidate.recentObservations.length > 20 || candidate.recentKeys.length > 1000) {
          add(findings, "warning", "wallet-candidates.json", `Historique récent au-delà des limites habituelles pour ${wallet}`);
        }
      }
    }
  }

  const rankings = await checkJson("wallet-rankings.json");
  if (rankings !== null) {
    if (!isRecord(rankings) || rankings.version !== 1 || !Array.isArray(rankings.wallets) ||
      !validDate(rankings.generatedAt, now)) {
      add(findings, "error", "wallet-rankings.json", "Enveloppe de classement invalide");
    } else {
      const keys = new Set<string>();
      for (const item of rankings.wallets) {
        if (!isRecord(item) || typeof item.wallet !== "string" || typeof item.quoteMint !== "string" ||
          typeof item.eligible !== "boolean" || !isRawInteger(item.realizedPnlRaw, true)) {
          add(findings, "error", "wallet-rankings.json", "Entrée de classement invalide");
          continue;
        }
        const key = JSON.stringify([item.wallet, item.quoteMint]);
        if (keys.has(key)) add(findings, "warning", "wallet-rankings.json", "Groupe wallet/quote dupliqué");
        keys.add(key);
      }
    }
  }

  const backfill = await checkJson("wallet-history-backfill.json");
  if (backfill !== null) {
    if (!isRecord(backfill) || backfill.version !== 1 || !isRecord(backfill.wallets)) {
      add(findings, "error", "wallet-history-backfill.json", "Format de reprise invalide");
    } else {
      for (const [wallet, progress] of Object.entries(backfill.wallets)) {
        if (!isRecord(progress) || !Number.isSafeInteger(progress.scanned) ||
          (progress.scanned as number) < 0 || typeof progress.complete !== "boolean" ||
          (progress.before !== undefined && typeof progress.before !== "string")) {
          add(findings, "error", "wallet-history-backfill.json", `Progression invalide pour ${wallet}`);
        }
      }
    }
  }

  const paper = await checkJson("paper-trading.json");
  if (paper !== null) {
    if (!isRecord(paper) || paper.version !== 1 || !isRecord(paper.balances) ||
      !Array.isArray(paper.positions) || !Array.isArray(paper.fills)) {
      add(findings, "error", "paper-trading.json", "Structure du portefeuille Paper Trading invalide");
    } else {
      for (const [mint, balance] of Object.entries(paper.balances)) {
        if (!isRawInteger(balance)) add(findings, "error", "paper-trading.json", `Solde invalide pour ${mint}`);
      }
      const positionKeys = new Set<string>();
      for (const position of paper.positions) {
        if (!isRecord(position) || typeof position.wallet !== "string" || typeof position.mint !== "string" ||
          typeof position.quoteMint !== "string" || !isRawInteger(position.tokenAmountRaw) ||
          !isRawInteger(position.costBasisRaw)) {
          add(findings, "error", "paper-trading.json", "Position invalide");
          continue;
        }
        if (BigInt(position.tokenAmountRaw) <= 0n || BigInt(position.costBasisRaw) <= 0n) {
          add(findings, "error", "paper-trading.json", "Position avec quantité ou coût nul/négatif");
        }
        const key = JSON.stringify([position.wallet, position.mint, position.quoteMint]);
        if (positionKeys.has(key)) add(findings, "warning", "paper-trading.json", "Position dupliquée");
        positionKeys.add(key);
      }
      const fillKeys = new Set<string>();
      for (const fill of paper.fills) {
        if (!isRecord(fill) || typeof fill.wallet !== "string" || typeof fill.sourceSignature !== "string" ||
          typeof fill.mint !== "string" || (fill.side !== "buy" && fill.side !== "sell") ||
          typeof fill.quoteMint !== "string" || !isRawInteger(fill.tokenAmountRaw) ||
          !isRawInteger(fill.quoteAmountRaw) || !isRawInteger(fill.feeQuoteRaw) ||
          !Number.isInteger(fill.slippageBps) || !validDate(fill.observedAt, now) ||
          (fill.realizedPnlRaw !== undefined && !isRawInteger(fill.realizedPnlRaw, true))) {
          add(findings, "error", "paper-trading.json", "Fill invalide");
          continue;
        }
        const key = JSON.stringify([fill.wallet, fill.sourceSignature, fill.mint]);
        if (fillKeys.has(key)) add(findings, "warning", "paper-trading.json", "Fill source dupliqué");
        fillKeys.add(key);
      }
      if (paper.positions.length > 0 && paper.fills.length === 0) {
        add(findings, "warning", "paper-trading.json", "Positions ouvertes sans aucun fill enregistré");
      }
    }
  }

  return { checkedFiles, findings };
}
