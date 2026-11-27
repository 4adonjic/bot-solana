import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { repairWalletHistoryTimestamps } from "./repair-wallet-history-timestamps.js";

test("dry-run reports recognizable multiplied timestamps without changing source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wallet-timestamp-repair-"));
  try {
    const filePath = join(directory, "wallet-trades.jsonl");
    const originalTimestamp = Date.UTC(2026, 0, 15, 12);
    const malformed = new Date(originalTimestamp * 1000).toISOString();
    const original = JSON.stringify({ wallet: "WalletA", observedAt: malformed }) + "\n";
    await writeFile(filePath, original);
    const report = await repairWalletHistoryTimestamps({ filePath, now: Date.UTC(2026, 1, 1) });
    assert.equal(report.repairableTimestamps, 1);
    assert.equal(report.invalidTimestamps, 0);
    assert.equal(await readFile(filePath, "utf8"), original);
    assert.equal("backupPath" in report, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("apply creates an exclusive backup and atomically repairs recognized timestamps", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wallet-timestamp-repair-"));
  try {
    const filePath = join(directory, "wallet-trades.jsonl");
    const originalTimestamp = Date.UTC(2026, 0, 15, 12);
    const malformed = new Date(originalTimestamp * 1000).toISOString();
    const original = JSON.stringify({ wallet: "WalletA", observedAt: malformed }) + "\n";
    await writeFile(filePath, original);
    const report = await repairWalletHistoryTimestamps({
      filePath, apply: true, now: Date.UTC(2026, 1, 1), backupSuffix: ".backup-test",
    });
    assert.equal(report.repairableTimestamps, 1);
    assert.equal(report.backupPath, filePath + ".backup-test");
    assert.equal(await readFile(report.backupPath!, "utf8"), original);
    const repaired = JSON.parse((await readFile(filePath, "utf8")).trim()) as { observedAt: string };
    assert.equal(repaired.observedAt, new Date(originalTimestamp).toISOString());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("does not guess at unrelated future timestamps", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wallet-timestamp-repair-"));
  try {
    const filePath = join(directory, "wallet-trades.jsonl");
    const future = new Date(Date.UTC(2040, 0, 1)).toISOString();
    const original = JSON.stringify({ wallet: "WalletA", observedAt: future }) + "\n";
    await writeFile(filePath, original);
    const report = await repairWalletHistoryTimestamps({ filePath, apply: true, now: Date.UTC(2026, 1, 1) });
    assert.equal(report.repairableTimestamps, 0);
    assert.equal(report.invalidTimestamps, 1);
    assert.equal(await readFile(filePath, "utf8"), original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
