import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { auditDataDirectory } from "./data-integrity.js";

test("empty data directory is healthy and remains untouched", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bot-data-audit-"));
  try {
    const report = await auditDataDirectory(directory);
    assert.equal(report.checkedFiles, 0);
    assert.deepEqual(report.findings, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reports malformed trade lines and implausible timestamps without modifying files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bot-data-audit-"));
  try {
    const tradePath = join(directory, "wallet-trades.jsonl");
    const content = [
      JSON.stringify({
        wallet: "WalletA", signature: "SignatureA", mint: "MintA", side: "buy",
        tokenAmountRaw: "10", tokenDecimals: 6, slot: 1,
        observedAt: "58876-01-01T00:00:00.000Z",
      }),
      "{not-json}",
    ].join("\n") + "\n";
    await writeFile(tradePath, content);
    const report = await auditDataDirectory(directory);
    assert.equal(report.checkedFiles, 1);
    assert.ok(report.findings.some((finding) => finding.message.includes("Date absente")));
    assert.ok(report.findings.some((finding) => finding.message.includes("JSON invalide ligne 2")));
    const { readFile } = await import("node:fs/promises");
    assert.equal(await readFile(tradePath, "utf8"), content);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reports inconsistent persisted Paper Trading state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bot-data-audit-"));
  try {
    await writeFile(join(directory, "paper-trading.json"), JSON.stringify({
      version: 1,
      balances: { SOL: "-1" },
      positions: [{ wallet: "WalletA", mint: "MintA", quoteMint: "SOL", tokenAmountRaw: "0", costBasisRaw: "0" }],
      fills: [],
    }));
    const report = await auditDataDirectory(directory);
    assert.ok(report.findings.some((finding) => finding.message.includes("Solde invalide")));
    assert.ok(report.findings.some((finding) => finding.message.includes("quantité ou coût nul")));
    assert.ok(report.findings.some((finding) => finding.message.includes("sans aucun fill")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
