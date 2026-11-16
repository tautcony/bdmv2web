import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMaxRssBytes, observeGc, runMemoryCapture } from "./memory.mjs";

test("maxRSS converts Node KiB values to bytes", () => {
  assert.equal(normalizeMaxRssBytes(12), 12 * 1024);
});

test("memory capture records process memory, maxRSS, and resource scopes", async () => {
  const result = await runMemoryCapture({ durationMs: 20, run: () => Buffer.alloc(64 * 1024) });
  assert.ok(result.iterations > 0);
  assert.ok(result.memory.samples.length >= 2);
  assert.ok(result.memory.maxRSSBytes > 0);
  assert.ok(result.memory.peakObservedRssBytes > 0);
  assert.equal(result.memory.maxRSSUnit, "bytes");
  assert.ok(result.memory.maxRssScope.length > 0);
  assert.ok(result.memory.externalScope.length > 0);
  assert.equal(result.gc.available, true);
  assert.ok(result.gc.scope.length > 0);
});

test("GC observer drains events delivered after synchronous collection", { skip: typeof globalThis.gc !== "function" }, async () => {
  const observer = observeGc();
  globalThis.gc();
  await observer.stop();
  assert.ok(observer.events.length > 0);
  for (const event of observer.events) assert.ok(typeof event.durationMs === "number" && event.durationMs >= 0);
});
