import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WalletCandidateStore } from "./wallet-candidate-store.js";

async function withTempStore<T>(run: (filePath: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "wallet-candidates-"));
  try {
    return await run(join(directory, "candidates.json"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const observation = {
  wallet: "WalletA",
  signature: "SignatureA",
  slot: 123,
  mint: "MintA",
  side: "buy" as const,
  tokenAmountRaw: "500",
  quoteAmountRaw: "250000000",
  quoteMint: "So11111111111111111111111111111111111111112",
  quoteDecimals: 9,
  quoteSource: "token_balance" as const,
  quoteAmountIsEstimate: false,
};

test("persists candidate observations and reloads them after restart", async () => {
  await withTempStore(async (filePath) => {
    const store = new WalletCandidateStore({ filePath });
    await store.init();
    const saved = await store.record(observation);
    assert.equal(saved.observationCount, 1);

    const restarted = new WalletCandidateStore({ filePath });
    await restarted.init();
    assert.equal(restarted.get("WalletA")?.observationCount, 1);
    assert.equal(restarted.get("WalletA")?.recentObservations[0]?.signature, "SignatureA");
    assert.equal(restarted.get("WalletA")?.recentObservations[0]?.quoteAmountRaw, "250000000");
  });
});

test("deduplicates the same signature and mint for a wallet", async () => {
  await withTempStore(async (filePath) => {
    const store = new WalletCandidateStore({ filePath });
    await store.init();
    await store.record(observation);
    await store.record(observation);
    assert.equal(store.get("WalletA")?.observationCount, 1);
    const saved = JSON.parse(await readFile(filePath, "utf8")) as { wallets: Record<string, { observationCount: number }> };
    assert.equal(saved.wallets.WalletA?.observationCount, 1);
  });
});

test("keeps recent observations and wallet count bounded", async () => {
  await withTempStore(async (filePath) => {
    const store = new WalletCandidateStore({ filePath, maxWallets: 2, maxRecentObservations: 2 });
    await store.init();
    await store.record(observation);
    await store.record({ ...observation, signature: "SignatureB", slot: 124 });
    await store.record({ ...observation, signature: "SignatureC", slot: 125 });
    await store.record({ ...observation, wallet: "WalletB", signature: "SignatureD" });
    await store.record({ ...observation, wallet: "WalletC", signature: "SignatureE" });

    assert.equal(store.list().length, 2);
    assert.equal(store.get("WalletA"), undefined);
    assert.equal(store.get("WalletB")?.recentObservations.length, 1);
  });
});

test("requires initialization and rejects invalid observations", async () => {
  const store = new WalletCandidateStore();
  assert.throws(() => store.list(), /init/);
  await withTempStore(async (filePath) => {
    const initialized = new WalletCandidateStore({ filePath });
    await initialized.init();
    await assert.rejects(
      initialized.record({ ...observation, slot: -1 }),
      /slot must be a non-negative/,
    );
  });
});
