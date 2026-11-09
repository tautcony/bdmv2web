import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SAMPLE_FILE, readSampleRef, writeSampleStore } from "./sample-store.mjs";

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
