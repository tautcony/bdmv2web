import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildTrend, html, loadRuns, markdown } from "./report.mjs";

function run(runId, createdAt, cpuModel = "CPU A") {
  return {
    file: `/runs/${runId}/run.json`,
    run: {
      schemaVersion: 1, mode: "benchmark", runId, createdAt,
      environment: { node: "v24.18.0", v8: "13", platform: "linux", release: "6", architecture: "x64", cpuModel, execArgv: [] },
      configuration: { engine: "tinybench", engineVersion: "6.2.3", warmupMs: 10, timeMs: 100, minSamples: 3 },
      rows: [{ caseId: "synthetic.parse", callsPerSample: 128, fixture: { id: "scale", version: "1", parameters: { size: 20 } }, category: "synthetic", name: "Synthetic parser run", sample: "synthetic-menu", source: { type: "file", disc: "Example disc", path: "PLAYLIST/00001.mpls" }, scope: "parse input", forks: [{ index: 0, stats: { median: 1 }, profilePath: `profiles/${runId}.cpuprofile` }, { index: 1, stats: { median: 1.2 } }] }],
      skipped: [{ caseId: "optional.case", reason: "input absent" }], failures: [],
    },
  };
}

test("trends group only matching environment and fixture identities", () => {
  const trend = buildTrend([run("a", "2026-01-01"), run("b", "2026-01-02"), run("c", "2026-01-03", "CPU B")]);
  assert.equal(trend.runCount, 3);
  assert.equal(trend.environmentSeriesCount, 2);
  assert.equal(trend.series.length, 2);
  assert.equal(trend.series.find((series) => series.runs.length === 2).runs[0].forkMedianMs, 1.1);
  assert.equal(trend.statuses.length, 3);
});

test("a CLI row reports the work left after its floor row", () => {
  const sample = run("a", "2026-01-01");
  sample.run.rows = [
    { caseId: "cli.perf.list.table", callsPerSample: 1, fixture: { id: "synthetic-clip-set", version: "2", parameters: {} }, category: "cli", name: "CLI list", scope: "cli-list-table", baselineCaseId: "cli.floor.list", forks: [{ index: 0, stats: { median: 120 } }] },
    { caseId: "cli.floor.list", callsPerSample: 1, fixture: { id: "cli-runtime", version: "1", parameters: {} }, category: "cli", name: "CLI list floor", scope: "cli-load-floor", floorRow: true, forks: [{ index: 0, stats: { median: 90 } }] },
  ];
  const trend = buildTrend([sample]);
  const cli = trend.series.find((series) => series.caseId === "cli.perf.list.table");
  assert.equal(cli.runs[0].floorMs, 90);
  assert.equal(cli.runs[0].attributedMs, 30);
  assert.equal(trend.summary.hotspots.slowest[0].caseId, "cli.perf.list.table");
  assert.equal(trend.summary.hotspots.slowest[0].value, 30);
  assert.equal(trend.summary.hotspots.slowest[0].medianMs, 120);
  assert.match(markdown(trend), /\| cli\.perf\.list\.table \| cli\.floor\.list \| 120\.00 \| 90\.000 \| 30\.000 \|/);
});

test("trend identity includes scope and canonical fixture parameters", () => {
  const base = run("a", "2026-01-01");
  const reordered = run("b", "2026-01-02");
  reordered.run.rows[0].fixture.parameters = { size: 20 };
  const differentScope = run("c", "2026-01-03");
  differentScope.run.rows[0].scope = "parse another range";
  const trend = buildTrend([base, reordered, differentScope]);
  assert.equal(trend.series.length, 2);
  assert.equal(trend.series.find((series) => series.runs.length === 2).runs.length, 2);
});

test("partial fork failures remain status records without successful trend points", () => {
  const sample = run("a", "2026-01-01");
  sample.run.failures.push({ caseId: "synthetic.parse", fork: 2, reason: "fork exited early" });
  const trend = buildTrend([sample]);
  assert.equal(trend.series.length, 0);
  assert.equal(trend.statuses[0].status, "failed");
});

test("profile manifests link artifacts relative to benchmark run records", () => {
  const benchmark = run("a", "2026-01-01");
  benchmark.run.environment.revision = "same-rev";
  delete benchmark.run.rows[0].forks[0].profilePath;
  const profile = { file: "/runs/profiles/run.json", run: { schemaVersion: 1, mode: "cpu", runId: "cpu-1", createdAt: "2026-01-01", environment: { ...benchmark.run.environment }, rows: [{ caseId: "synthetic.parse", fixture: benchmark.run.rows[0].fixture, artifacts: ["profiles/profile.cpuprofile"] }] } };
  const trend = buildTrend([benchmark, profile]);
  assert.equal(trend.profileRunCount, 1);
  assert.equal(trend.series[0].runs[0].profiles[0].path, "profiles/profile.cpuprofile");
  assert.equal(trend.series[0].runs[0].profiles[0].runDirectory, "/runs/profiles");
});

test("Markdown and standalone HTML preserve profile links and process-level labels", () => {
  const trend = buildTrend([run("a", "2026-01-01")]);
  assert.match(markdown(trend), /a\.cpuprofile/);
  assert.match(markdown(trend), /median of independent process fork medians/);
  assert.match(markdown(trend), /\| Calls\/sample \|/);
  assert.match(markdown(trend), /synthetic\.parse \| scale \| env-01 \| a \| 2 \| 128 \|/);
  const output = html(trend, "/reports");
  assert.match(output, /<svg/);
  assert.ok(output.includes("href=\"../runs/a/profiles/a.cpuprofile\""));
  assert.match(output, /min–max fork medians in milliseconds/);
  assert.match(output, /Synthetic parser run/);
  assert.match(output, /Example disc · PLAYLIST\/00001\.mpls/);
  assert.match(output, /Fork median range \(ms\)/);
  assert.match(output, /<th[^>]*>Calls\/sample<\/th>/);
  assert.match(output, /Profile and browser captures/);
  assert.match(output, /id="changes"/);
  assert.match(output, /Latency distribution/);
  assert.match(output, /data-current="true"/);
  assert.ok(output.includes("href=\"../runs/a/profiles/a.cpuprofile\""));
  assert.match(output, /text-anchor="end"/);
  assert.doesNotMatch(output, /https?:\/\//);
  assert.doesNotMatch(output, /file:\/\//);
});

test("merged comparison records supersede their source runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "bench-report-merge-"));
  try {
    const rawA = run("raw-a", "2026-01-01"), rawB = run("raw-b", "2026-01-02");
    const merged = run("merged", "2026-01-03");
    merged.run.sourceRunIds = ["raw-a", "raw-b"];
    for (const entry of [rawA, rawB, merged]) {
      const directory = join(root, entry.run.runId);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "run.json"), JSON.stringify(entry.run));
    }
    const trend = buildTrend(await loadRuns([root]));
    assert.deepEqual(trend.series[0].runs.map((item) => item.runId), ["merged"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("report CLI reads run directories and writes portable HTML and Markdown outputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "bench-report-cli-"));
  try {
    const runDir = join(root, "runs", "run-a"), reportDir = join(root, "reports");
    await mkdir(runDir, { recursive: true }); await mkdir(reportDir, { recursive: true });
    const record = run("a", "2026-01-01").run;
    record.environment.revision = "123456789";
    await writeFile(join(runDir, "run.json"), JSON.stringify(record));
    const script = fileURLToPath(new URL("./report.mjs", import.meta.url));
    const htmlPath = join(reportDir, "trend.html"), markdownPath = join(reportDir, "nested", "trend.md");
    const htmlResult = spawnSync(process.execPath, [script, join(root, "runs"), "--format", "html", "--out", htmlPath], { encoding: "utf8" });
    const mdResult = spawnSync(process.execPath, [script, join(root, "runs"), "--format", "markdown", "--out", markdownPath], { encoding: "utf8" });
    assert.equal(htmlResult.status, 0, htmlResult.stderr);
    assert.equal(mdResult.status, 0, mdResult.stderr);
    assert.match(htmlResult.stdout, /Wrote html report: .*trend\.html/);
    assert.match(htmlResult.stdout, /Source records: 1 benchmark runs, 0 profile records, 0 recorded failures, 1 recorded skips\./);
    assert.match(htmlResult.stdout, /Recorded failures and skips belong to those source runs/);
    assert.match(mdResult.stdout, /Wrote markdown report: .*trend\.md/);
    const htmlOutput = await readFile(htmlPath, "utf8"), markdownOutput = await readFile(markdownPath, "utf8");
    assert.match(htmlOutput, /viewBox="0 0/);
    assert.match(htmlOutput, /1234567/);
    assert.match(htmlOutput, /Recorded run failures and skips/);
    assert.match(htmlOutput, /do not describe this report's rendering/);
    assert.match(markdownOutput, /synthetic\.parse/);
    assert.match(markdownOutput, /## Recorded run failures and skips/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("GC counts come from the stored summary and from inline legacy events", () => {
  const summarized = run("a", "2026-01-01");
  summarized.run.rows[0].forks[0].gc = { available: true, eventCount: 3 };
  summarized.run.rows[0].forks[1].gc = { available: true, events: [{}, {}] };
  assert.equal(buildTrend([summarized]).series[0].runs[0].gcEvents, 5);

  const legacy = run("b", "2026-01-02");
  legacy.run.rows[0].forks[0].gc = { available: true, events: [{}, {}] };
  assert.equal(buildTrend([legacy]).series[0].runs[0].gcEvents, 2);
});

test("report data separates the current session from historical series", () => {
  const historical = run("old", "2026-01-01");
  const current = run("new", "2026-01-02");
  const trend = buildTrend([historical, current]);
  assert.equal(trend.summary.runs, 2);
  assert.equal(trend.summary.currentRuns, 1);
  assert.equal(trend.summary.cases, 1);
  assert.equal(trend.summary.allSeries, 1);
  assert.equal(trend.series[0].current, true);
  assert.equal(trend.series[0].change, null);
  assert.equal(trend.summary.improvements, 0);
  assert.match(html(trend), /Current session:/);
  assert.match(html(trend), /Current session only/);
});

test("report data derives GC, CPU, memory, and distribution from fork details", () => {
  const sampled = run("details", "2026-01-01");
  const row = sampled.run.rows[0];
  row.callsPerSample = 2;
  const fork = row.forks[0];
  fork.iterations = 10;
  fork.callsPerSample = 2;
  fork.sampleValues = Float64Array.from([1, 1, 2, 3]);
  fork.gcEventList = [{ kind: 1, durationMs: 2 }, { kind: 4, durationMs: 2 }];
  fork.memory = { heapUsedBytes: 1024, peakObservedRssBytes: 2048, maxRSSBytes: 4096, externalBytes: 512 };
  fork.cpuUsage = { user: 1000, system: 1000, coversSpawnedProcess: true };
  const latest = buildTrend([sampled]).series[0].runs[0];
  assert.equal(latest.gc.events, 2);
  assert.equal(latest.gc.major, 1);
  assert.equal(latest.gc.minor, 1);
  assert.equal(latest.gc.msPerCall, 0.2);
  assert.equal(latest.cpuMsPerCall, 0.1);
  assert.equal(latest.memory.heapUsedBytes, 1024);
  assert.equal(latest.distribution.sampleCount, 4);
  assert.equal(latest.distribution.p25, 1);
  assert.equal(latest.parentOnly, false);
});

test("parent-only measurements are marked and stay out of work hotspots", () => {
  const sampled = run("cli-like", "2026-01-01");
  const fork = sampled.run.rows[0].forks[0];
  fork.iterations = 5;
  fork.gcEventList = [{ kind: 1, durationMs: 5 }];
  fork.memory = { heapUsedBytes: 4096 };
  fork.cpuUsage = { user: 100, system: 0, coversSpawnedProcess: false };
  const trend = buildTrend([sampled]);
  const latest = trend.series[0].runs[0];
  assert.equal(latest.parentOnly, true);
  assert.equal(latest.gc.parentOnly, true);
  assert.equal(trend.summary.hotspots.gc.length, 0);
  assert.equal(trend.summary.hotspots.heap.length, 0);
});

test("recorded failure paths are sanitized in reports", () => {
  const sample = run("paths", "2026-01-01");
  sample.run.failures.push({ caseId: "other.case", reason: "at file:///Users/alice/repo/scripts/bench/runner/worker.mjs:1:2" });
  const trend = buildTrend([sample]);
  const output = html(trend, "/reports");
  assert.doesNotMatch(output, /alice/);
  assert.match(output, /&lt;home&gt;/);
  assert.match(markdown(trend), /<home>/);
});

test("change ranking renders a current-session pair", () => {
  const before = run("before", "2026-01-01T00:00:00.000Z");
  const after = run("after", "2026-01-01T01:00:00.000Z");
  for (const fork of before.run.rows[0].forks) fork.stats.median = 10;
  for (const fork of after.run.rows[0].forks) fork.stats.median = 5;
  const trend = buildTrend([before, after]);
  assert.equal(trend.summary.improvements, 1);
  assert.equal(trend.series[0].change.status, "improvement");
  const output = html(trend, "/reports");
  assert.match(output, /Performance change/);
  assert.match(output, /-50\.0%/);
  assert.match(output, /<svg/);
});

test("child measurements become the CLI GC and memory source", () => {
  const sampled = run("cli-child", "2026-01-01");
  const fork = sampled.run.rows[0].forks[0];
  fork.cpuUsage = { user: 1000, system: 0, coversSpawnedProcess: false };
  fork.child = {
    calls: 2, durationMs: 400,
    gc: { events: 4, durationMs: 8, major: 1, minor: 3, maxPauseMs: 3 },
    memory: { heapUsedBytes: 1024, rssBytes: 2048, maxRSSBytes: 4096, externalBytes: 512 },
  };
  const latest = buildTrend([sampled]).series[0].runs[0];
  assert.equal(latest.gc.parentOnly, false);
  assert.equal(latest.gc.msPerCall, 4);
  assert.equal(latest.memory.heapUsedBytes, 1024);
  assert.equal(latest.cpuParentOnly, true);
  assert.equal(latest.parentOnly, false);
});
