import assert from "node:assert/strict";
import { test } from "node:test";
import { createSecurityAnalysisCache } from "./security-cache.js";

test("reuses a successful analysis during the TTL", async () => {
  let calls = 0;
  let now = 1_000;
  const analyze = createSecurityAnalysisCache(
    async (mint: string) => ({ mint, call: ++calls }),
    { ttlMs: 60_000, now: () => now },
  );

  const first = await analyze("MintA");
  now += 30_000;
  const second = await analyze("MintA");

  assert.deepEqual(first, { mint: "MintA", call: 1 });
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
});

test("shares the same in-flight analysis for concurrent requests", async () => {
  let calls = 0;
  let release: ((value: string) => void) | undefined;
  const analyze = createSecurityAnalysisCache(
    () => {
      calls += 1;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    },
  );

  const first = analyze("MintA");
  const second = analyze("MintA");
  await Promise.resolve();
  assert.equal(calls, 1);
  release?.("done");
  assert.equal(await first, "done");
  assert.equal(await second, "done");
});

test("runs a fresh analysis after the TTL expires", async () => {
  let calls = 0;
  let now = 0;
  const analyze = createSecurityAnalysisCache(
    async () => ++calls,
    { ttlMs: 100, now: () => now },
  );

  assert.equal(await analyze("MintA"), 1);
  now = 101;
  assert.equal(await analyze("MintA"), 2);
});

test("does not cache rejected analyses", async () => {
  let calls = 0;
  const analyze = createSecurityAnalysisCache(async () => {
    calls += 1;
    if (calls === 1) throw new Error("temporary failure");
    return "recovered";
  });

  await assert.rejects(analyze("MintA"), /temporary failure/);
  assert.equal(await analyze("MintA"), "recovered");
  assert.equal(calls, 2);
});

test("evicts the least recently used mint when the cache is full", async () => {
  let calls = 0;
  const analyze = createSecurityAnalysisCache(
    async (mint: string) => ({ mint, call: ++calls }),
    { maxEntries: 2 },
  );

  await analyze("MintA");
  await analyze("MintB");
  await analyze("MintA"); // MintA becomes most recently used.
  await analyze("MintC"); // MintB is evicted.
  await analyze("MintA");
  await analyze("MintB");

  assert.equal(calls, 4);
});
