import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { bootstrap, compareRuns, markdown } from "./compare.mjs";

function makeRun(runId, median, environment = {}, fixture = {}) {
  return {
    schemaVersion: 1, mode: "benchmark", runId,
    environment: { node: "v24.18.0", v8: "13", platform: "linux", release: "6", architecture: "x64", cpuModel: "CPU", execArgv: [], ...environment },
    configuration: { engine: "tinybench", engineVersion: "6.2.3", warmupMs: 10, timeMs: 100, minSamples: 3 },
    rows: [{ caseId: "synthetic.parse", fixture: { id: "synthetic", version: "1", parameters: { size: 20, shape: "flat" }, ...fixture }, category: "synthetic", name: "synthetic parse", sample: "synthetic", scope: "parse", forks: median.map((value, index) => ({ index, stats: { median: value, p95: value * 1.1 }, rawMsPerCall: [value] })) }],
    skipped: [], failures: [],
  };
}

test("bootstrap resamples process medians deterministically", () => {
  const first = bootstrap([1, 2, 3], [2, 3, 4], 42, 1000);
  assert.deepEqual(first, bootstrap([1, 2, 3], [2, 3, 4], 42, 1000));
  assert.ok(Number.isFinite(first.lowMs));
  assert.ok(first.highMs >= first.lowMs);
});

test("comparison uses process fork medians and confirms a regression only with both thresholds and sufficient confidence", () => {
  const report = compareRuns(makeRun("base", [1, 1.1, 1.05]), makeRun("candidate", [1.3, 1.35, 1.4]), { relativeThreshold: 10, absoluteThresholdMs: 0.05, resamples: 1000 });
  assert.equal(report.rows[0].status, "compared");
  assert.equal(report.rows[0].verdict, "confirmed-regression");
  assert.equal(report.rows[0].baseline.medianMs, 1.05);
  assert.ok(report.rows[0].confidence.lowMs > 0);
  assert.match(markdown(report), /process bootstrap interval/);
});

test("comparison identifies incompatible environment, fixtures, missing, skipped, and failed cases", () => {
  const before = makeRun("base", [1, 1.1, 1.05]);
  const after = makeRun("candidate", [0.5, 0.6, 0.55], { cpuModel: "Other" }, { parameters: { size: 21, shape: "flat" } });
  after.rows.push({ caseId: "new", fixture: {}, forks: [] });
  before.skipped.push({ caseId: "skip-case", reason: "optional input absent" });
  after.failures.push({ caseId: "fail-case", reason: "worker failed" });
  const report = compareRuns(before, after, { relativeThreshold: 10, absoluteThresholdMs: 0.05, resamples: 1000 });
  assert.equal(report.rows.find((row) => row.caseId === "synthetic.parse").status, "incompatible");
  assert.ok(report.rows.find((row) => row.caseId === "synthetic.parse").mismatches.includes("environment.cpuModel"));
  assert.equal(report.rows.find((row) => row.caseId === "new").status, "missing");
  assert.equal(report.rows.find((row) => row.caseId === "skip-case").status, "skipped");
  assert.equal(report.rows.find((row) => row.caseId === "fail-case").status, "failed");
});

test("few forks and overlapping confidence intervals carry an insufficient-confidence label", () => {
  const report = compareRuns(makeRun("base", [1, 1.01]), makeRun("candidate", [1.3, 1.31]), { relativeThreshold: 10, absoluteThresholdMs: 0.05, resamples: 1000 });
  assert.equal(report.rows[0].confidence.sufficient, false);
  assert.equal(report.rows[0].verdict, "regression-warning");
  assert.match(report.rows[0].confidence.note, /confidence is insufficient/);
  const faster = compareRuns(makeRun("base", [2, 2.01]), makeRun("candidate", [1, 1.01]), { relativeThreshold: 10, absoluteThresholdMs: 0.05, resamples: 1000 });
  assert.equal(faster.rows[0].verdict, "improvement-warning");
});

test("regression warning requires both relative and absolute thresholds", () => {
  const report = compareRuns(makeRun("base", [1, 1.01, 1.02]), makeRun("candidate", [1.06, 1.07, 1.08]), { relativeThreshold: 5, absoluteThresholdMs: 0.1, resamples: 1000 });
  assert.equal(report.rows[0].verdict, "no-regression");
});

test("scope changes are incompatible and partial fork failures suppress verdicts", () => {
  const before = makeRun("base", [1, 1.1, 1.05]);
  const after = makeRun("candidate", [2, 2.1, 2.05]);
  after.rows[0].scope = "parse different input range";
  after.failures.push({ caseId: "synthetic.parse", reason: "fork 3 crashed" });
  const report = compareRuns(before, after, { relativeThreshold: 10, absoluteThresholdMs: 0.05, resamples: 1000 });
  assert.equal(report.rows[0].status, "failed");
  assert.equal(report.rows[0].verdict, "unclassified");
  after.failures = [];
  const incompatible = compareRuns(before, after, { relativeThreshold: 10, absoluteThresholdMs: 0.05, resamples: 1000 });
  assert.equal(incompatible.rows[0].status, "incompatible");
  assert.ok(incompatible.rows[0].mismatches.includes("scope"));
});

test("Node options and profile build mode are part of environment compatibility", () => {
  const before = makeRun("base", [1, 1.1, 1.05]);
  const after = makeRun("candidate", [0.5, 0.6, 0.55], { nodeOptions: "--trace-gc", profileBuildMode: true });
  const report = compareRuns(before, after, { relativeThreshold: 10, absoluteThresholdMs: 0.05, resamples: 1000 });
  assert.equal(report.rows[0].status, "incompatible");
  assert.ok(report.rows[0].mismatches.includes("environment.nodeOptions"));
  assert.ok(report.rows[0].mismatches.includes("environment.profileBuildMode"));
});

test("fail-on-regression gates confirmed results and keeps uncertain observations as warnings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bench-compare-"));
  try {
    const baselinePath = join(directory, "baseline.json"), candidatePath = join(directory, "candidate.json"), comparisonPath = join(directory, "comparison.json");
    const baseline = makeRun("base", [1, 1.01, 1.02]);
    const candidate = makeRun("candidate", [1.4, 1.41, 1.42]);
    await writeFile(baselinePath, JSON.stringify(baseline)); await writeFile(candidatePath, JSON.stringify(candidate));
    const script = fileURLToPath(new URL("./compare.mjs", import.meta.url));
    const confirmed = spawnSync(process.execPath, [script, baselinePath, candidatePath, "--fail-on-regression", "--out", comparisonPath], { encoding: "utf8" });
    assert.equal(confirmed.status, 1);
    assert.equal(JSON.parse(await readFile(comparisonPath, "utf8")).rows[0].verdict, "confirmed-regression");
    const uncertainPath = join(directory, "uncertain.json"), uncertainComparison = join(directory, "uncertain-comparison.json");
    await writeFile(uncertainPath, JSON.stringify(makeRun("uncertain", [1.4, 1.41])));
    const uncertain = spawnSync(process.execPath, [script, baselinePath, uncertainPath, "--fail-on-regression", "--out", uncertainComparison], { encoding: "utf8" });
    assert.equal(uncertain.status, 0);
    assert.equal(JSON.parse(await readFile(uncertainComparison, "utf8")).rows[0].verdict, "regression-warning");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
