import assert from "node:assert/strict";
import test from "node:test";
import { mergeRuns, parseArgs } from "./ci.mjs";

test("CI pair accepts explicit roots, cases, and measurement budgets", () => {
  assert.deepEqual(parseArgs(["--baseline-root", "/base", "--candidate-root", "/candidate", "--out", "/tmp/result", "--case", "scale.rle-1x.decode,cli.perf.metadata.inspect", "--warmup-ms", "5", "--time-ms", "20", "--min-samples", "3"]), {
    baselineRoot: "/base", candidateRoot: "/candidate", out: "/tmp/result", cases: ["scale.rle-1x.decode", "cli.perf.metadata.inspect"], warmupMs: 5, timeMs: 20, minSamples: 3,
  });
});

test("CI aggregation preserves independent fork observations and case failures", () => {
  const run = (runId, value, failure = []) => ({ schemaVersion: 1, mode: "benchmark", runId, createdAt: "2026-01-01", environment: { revision: runId }, configuration: { forks: 1 }, rows: [{ caseId: "case.a", fixture: { id: "fixture", version: "1", parameters: {} }, category: "synthetic", name: "case", sample: "fixture", scope: "parse", forks: [{ index: 0, stats: { median: value }, rawMsPerCall: [value] }], stats: { median: value, forkCount: 1 } }], skipped: [], failures: failure });
  const merged = mergeRuns([run("one", 2), run("two", 4, [{ caseId: "case.a", fork: 0, reason: "worker exit" }])], "baseline");
  assert.equal(merged.rows[0].forks.length, 2);
  assert.deepEqual(merged.rows[0].forks.map((fork) => fork.stats.median), [2, 4]);
  assert.equal(merged.rows[0].stats.median, 3);
  assert.equal(merged.rows[0].stats.mean, 3);
  assert.equal(merged.rows[0].stats.forkCount, 2);
  assert.equal(merged.rows[0].forks[0].sourceRunId, "one");
  assert.deepEqual(merged.sourceRunIds, ["one", "two"]);
  assert.equal(merged.configuration.forks, 2);
  assert.equal(merged.failures.length, 1);
});
