import assert from "node:assert/strict";
import { test } from "node:test";
import { createConcurrencyLimiter } from "./concurrency-limit.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("never runs more than the configured number of tasks at once", async () => {
  let active = 0;
  let peak = 0;
  const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
  const limited = createConcurrencyLimiter(async (index: number) => {
    active += 1;
    peak = Math.max(peak, active);
    await gates[index]!.promise;
    active -= 1;
    return index;
  }, { maxConcurrent: 2 });

  const first = limited(0);
  const second = limited(1);
  const third = limited(2);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(peak, 2);

  gates[0]!.resolve();
  assert.equal(await first, 0);
  await Promise.resolve();
  assert.equal(peak, 2);
  gates[1]!.resolve();
  gates[2]!.resolve();
  assert.deepEqual(await Promise.all([second, third]), [1, 2]);
  assert.equal(active, 0);
});

test("rejects new work when the waiting queue is full", async () => {
  const gate = deferred<void>();
  const limited = createConcurrencyLimiter(async (value: number) => {
    await gate.promise;
    return value;
  }, { maxConcurrent: 1, maxQueued: 1 });

  const active = limited(1);
  const queued = limited(2);
  await assert.rejects(limited(3), /queue is full/);
  gate.resolve();
  assert.deepEqual(await Promise.all([active, queued]), [1, 2]);
});

test("continues processing queued tasks after a task fails", async () => {
  const limited = createConcurrencyLimiter(async (value: number) => {
    if (value === 1) throw new Error("temporary failure");
    return value;
  }, { maxConcurrent: 1 });

  const failed = limited(1);
  const next = limited(2);
  await assert.rejects(failed, /temporary failure/);
  assert.equal(await next, 2);
});

test("validates concurrency and queue limits", () => {
  assert.throws(() => createConcurrencyLimiter(async () => 1, { maxConcurrent: 0 }));
  assert.throws(() => createConcurrencyLimiter(async () => 1, { maxQueued: -1 }));
});
