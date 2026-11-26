import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { WalletTradeStore, type WalletTradeObservation } from "./wallet-trade-store.js";

function observation(overrides: Partial<WalletTradeObservation> = {}): WalletTradeObservation {
  return {
    wallet: "WalletA",
    signature: "SignatureA",
    mint: "MintA",
    side: "buy",
    tokenAmountRaw: "123456",
    tokenDecimals: 6,
    quoteAmountRaw: "987654321",
    quoteMint: "So11111111111111111111111111111111111111112",
    quoteDecimals: 9,
    quoteSource: "token_balance",
    quoteAmountIsEstimate: false,
    observedAt: "2026-01-01T00:00:00.000Z",
    slot: 123,
    ...overrides,
  };
}

async function withStore(
  run: (path: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "wallet-trade-store-"));
  try {
    await run(join(directory, "history.jsonl"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("persists observations and reloads them after restart", async () => {
  await withStore(async (path) => {
    const first = new WalletTradeStore({ filePath: path });
    await first.init();
    await first.record(observation());
    await first.record(observation({ signature: "SignatureB", side: "sell" }));

    const second = new WalletTradeStore({ filePath: path });
    await second.init();
    assert.equal(second.count(), 2);
    assert.deepEqual(second.list().map((item) => item.signature), ["SignatureA", "SignatureB"]);
  });
});

test("deduplicates the same wallet, signature and mint", async () => {
  await withStore(async (path) => {
    const store = new WalletTradeStore({ filePath: path });
    await store.init();
    const first = await store.record(observation());
    const duplicate = await store.record(observation({ tokenAmountRaw: "999" }));

    assert.equal(first.inserted, true);
    assert.equal(duplicate.inserted, false);
    assert.equal(duplicate.observation.tokenAmountRaw, "123456");
    assert.equal(store.count(), 1);
    assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 1);
  });
});

test("serializes concurrent writes and deduplicates them", async () => {
  await withStore(async (path) => {
    const store = new WalletTradeStore({ filePath: path });
    await store.init();
    const results = await Promise.all([
      store.record(observation()),
      store.record(observation()),
      store.record(observation({ signature: "SignatureB" })),
    ]);

    assert.equal(store.count(), 2);
    assert.equal(results.filter((item) => item.inserted).length, 2);
  });
});

test("refuses new observations rather than silently deleting old history at capacity", async () => {
  await withStore(async (path) => {
    const store = new WalletTradeStore({ filePath: path, maxTrades: 1 });
    await store.init();
    await store.record(observation());
    await assert.rejects(
      store.record(observation({ signature: "SignatureB" })),
      /history is full/,
    );
    assert.equal(store.count(), 1);
  });
});

test("requires initialization and rejects malformed persisted lines", async () => {
  await withStore(async (path) => {
    const store = new WalletTradeStore({ filePath: path });
    await assert.rejects(Promise.resolve().then(() => store.count()), /init\(\)/);
    const { appendFile } = await import("node:fs/promises");
    await appendFile(path, "{broken json}\n", "utf8");
    const reloaded = new WalletTradeStore({ filePath: path });
    await assert.rejects(reloaded.init(), /Invalid JSON.*line 1/);
  });
});
