import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const MIN_VALID_MS = Date.UTC(2009, 0, 1);
const MAX_VALID_MS = Date.now() + 5 * 60 * 1000;

export interface TimestampRepairReport {
  totalLines: number;
  validTimestamps: number;
  repairableTimestamps: number;
  invalidTimestamps: number;
  unchangedLines: number;
}

export interface TimestampRepairOptions {
  filePath: string;
  apply?: boolean;
  now?: number;
  backupSuffix?: string;
}

export async function repairWalletHistoryTimestamps(
  options: TimestampRepairOptions,
): Promise<TimestampRepairReport & { backupPath?: string }> {
  const now = options.now ?? Date.now();
  const content = await readFile(options.filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const output: string[] = [];
  const report: TimestampRepairReport = {
    totalLines: 0,
    validTimestamps: 0,
    repairableTimestamps: 0,
    invalidTimestamps: 0,
    unchangedLines: 0,
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      output.push(line);
      continue;
    }
    report.totalLines++;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`JSON invalide ligne ${index + 1}; aucune modification effectuée`);
    }
    if (typeof parsed !== "object" || parsed === null || !("observedAt" in parsed) ||
      typeof parsed.observedAt !== "string") {
      report.invalidTimestamps++;
      output.push(line);
      continue;
    }

    const timestamp = Date.parse(parsed.observedAt);
    if (!Number.isFinite(timestamp)) {
      report.invalidTimestamps++;
      output.push(line);
      continue;
    }
    if (timestamp >= MIN_VALID_MS && timestamp <= now + 5 * 60 * 1000) {
      report.validTimestamps++;
      output.push(line);
      continue;
    }

    // Historical bug: a millisecond timestamp was multiplied by 1000 before
    // Date construction. Dividing the parsed epoch by 1000 reverses only this
    // recognizable pattern when the result falls inside Solana's date range.
    const repairedTimestamp = timestamp / 1000;
    if (timestamp > now + 5 * 60 * 1000 &&
      Number.isFinite(repairedTimestamp) &&
      repairedTimestamp >= MIN_VALID_MS &&
      repairedTimestamp <= now + 5 * 60 * 1000) {
      report.repairableTimestamps++;
      const repaired = { ...parsed, observedAt: new Date(repairedTimestamp).toISOString() };
      output.push(JSON.stringify(repaired));
    } else {
      report.invalidTimestamps++;
      output.push(line);
    }
  }

  report.unchangedLines = report.totalLines - report.repairableTimestamps;
  if (!options.apply || report.repairableTimestamps === 0) return report;

  const backupPath = options.filePath + (options.backupSuffix ?? `.backup-${new Date(now).toISOString().replace(/[:.]/g, "-")}`);
  await copyFile(options.filePath, backupPath, 1); // COPYFILE_EXCL: never overwrite a backup.
  const temporaryPath = join(dirname(options.filePath), `.${basename(options.filePath)}.repair.tmp`);
  try {
    await writeFile(temporaryPath, output.join("\n"), { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, options.filePath);
  } catch (error) {
    const { unlink } = await import("node:fs/promises");
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return { ...report, backupPath };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const fileArg = args.find((arg) => !arg.startsWith("--"));
  const filePath = fileArg ?? "data/wallet-trades.jsonl";
  const report = await repairWalletHistoryTimestamps({ filePath, apply });
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", filePath, ...report }, null, 2));
  if (report.invalidTimestamps > 0) {
    console.error("Des dates invalides non reconnues restent inchangées; examine le rapport avant toute autre action.");
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/repair-wallet-history-timestamps.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
