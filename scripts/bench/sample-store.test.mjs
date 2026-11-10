import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GC_CHANNELS, GC_FILE, MEMORY_CHANNELS, MEMORY_FILE, SAMPLE_FILE, isSampleRef, readGcSeries, readMemorySeries, readSampleRef, writeSampleStore } from "./sample-store.mjs";

const values = [0.0006671234567890123, 1 / 3, 1234.5678901234567, 0, 2 ** -42];

function row(samples) {
  return { caseId: "case.a", forks: samples.map((rawMsPerCall, index) => ({ index, rawMsPerCall })) };
}

test("sample store moves per-call milliseconds into a float64 file without losing precision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bench-samples-"));
  const rows = [row([values, values.slice(0, 2)])];
  const store = await writeSampleStore(dir, rows);
  assert.equal(store.file, SAMPLE_FILE);
  assert.equal(store.count, values.length + 2);
  assert.equal(store.bytes, store.count * 8);
  assert.equal((await stat(join(dir, SAMPLE_FILE))).size, store.bytes);
  assert.deepEqual(rows[0].forks[0].rawMsPerCall, { encoding: "float64le", file: SAMPLE_FILE, offset: 0, count: values.length });
  assert.equal(rows[0].forks[1].rawMsPerCall.offset, values.length * 8);
  assert.deepEqual(Array.from(await readSampleRef(dir, rows[0].forks[0])), values);
  assert.deepEqual(Array.from(await readSampleRef(dir, rows[0].forks[1])), values.slice(0, 2));
});

test("merged runs copy referenced sample blocks into their own file", async () => {
  const sourceDir = await mkdtemp(join(tmpdir(), "bench-samples-source-"));
  const mergedDir = await mkdtemp(join(tmpdir(), "bench-samples-merged-"));
  const sourceRows = [row([values])];
  await writeSampleStore(sourceDir, sourceRows);
  const merged = [{ caseId: "case.a", forks: [
    { index: 0, sourceRunId: "one", rawMsPerCall: sourceRows[0].forks[0].rawMsPerCall },
    { index: 1, sourceRunId: "two", rawMsPerCall: [1, 2, 3] },
  ] }];
  const store = await writeSampleStore(mergedDir, merged, { sources: new Map([["one", sourceDir]]) });
  assert.equal(store.count, values.length + 3);
  assert.deepEqual(Array.from(await readSampleRef(mergedDir, merged[0].forks[0])), values);
  assert.deepEqual(Array.from(await readSampleRef(mergedDir, merged[0].forks[1])), [1, 2, 3]);
});

const snapshots = [
  { rss: 101, heapUsed: 11, external: 1, arrayBuffers: 0.5 },
  { rss: 202, heapUsed: 22, external: 2, arrayBuffers: 1.5 },
];

test("memory snapshots leave the record and land interleaved in their own file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bench-memory-"));
  const rows = [{ caseId: "case.a", forks: [{ index: 0, rawMsPerCall: values, memory: { sampleCount: snapshots.length, samples: snapshots } }] }];
  await writeSampleStore(dir, rows);
  const fork = rows[0].forks[0];
  assert.equal(fork.memory.samples, undefined, "the record keeps the summary, not the series");
  assert.equal(fork.memory.sampleCount, 2);
  assert.ok(isSampleRef(fork.memory.series));
  assert.deepEqual(fork.memory.series.channels, MEMORY_CHANNELS);
  assert.equal(fork.memory.series.stride, MEMORY_CHANNELS.length);
  assert.equal(fork.memory.series.count, snapshots.length * MEMORY_CHANNELS.length);
  assert.equal((await stat(join(dir, MEMORY_FILE))).size, snapshots.length * MEMORY_CHANNELS.length * 8);
  assert.deepEqual(await readMemorySeries(dir, fork.memory), snapshots);
});

test("a merged record copies memory blocks instead of pointing at the old run", async () => {
  const sourceDir = await mkdtemp(join(tmpdir(), "bench-memory-source-"));
  const mergedDir = await mkdtemp(join(tmpdir(), "bench-memory-merged-"));
  const sourceRows = [{ caseId: "case.a", forks: [{ index: 0, memory: { samples: snapshots } }] }];
  await writeSampleStore(sourceDir, sourceRows);
  const merged = [{ caseId: "case.a", forks: [{ index: 0, sourceRunId: "one", memory: { ...sourceRows[0].forks[0].memory } }] }];
  await writeSampleStore(mergedDir, merged, { sources: new Map([["one", sourceDir]]) });
  assert.deepEqual(await readMemorySeries(mergedDir, merged[0].forks[0].memory), snapshots);
});

const gcEvents = [
  { kind: 1, flags: 0, durationMs: 0.06987500190734863, startTimeMs: 160.166166 },
  { kind: 2, flags: 0, durationMs: 1.25, startTimeMs: 161.969958 },
];

test("gc events leave the record as four-column float64 rows with a count summary", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bench-gc-"));
  const rows = [{ caseId: "case.a", forks: [
    { index: 0, rawMsPerCall: values, gc: { available: true, unavailableReason: null, events: gcEvents } },
    { index: 1, rawMsPerCall: values, gc: { available: true, unavailableReason: null, events: [] } },
  ] }];
  await writeSampleStore(dir, rows);
  for (const fork of rows[0].forks) {
    assert.equal(fork.gc.events, undefined, "the record keeps the count, not the events");
    assert.ok(isSampleRef(fork.gc.series));
    assert.deepEqual(fork.gc.series.channels, GC_CHANNELS);
    assert.equal(fork.gc.series.file, GC_FILE);
  }
  assert.equal(rows[0].forks[0].gc.eventCount, gcEvents.length);
  assert.equal(rows[0].forks[1].gc.eventCount, 0, "a fork without GC keeps a zero-count reference");
  assert.equal((await stat(join(dir, GC_FILE))).size, gcEvents.length * GC_CHANNELS.length * 8);
  assert.deepEqual(await readGcSeries(dir, rows[0].forks[0].gc), gcEvents);
  assert.deepEqual(await readGcSeries(dir, rows[0].forks[1].gc), []);
});
