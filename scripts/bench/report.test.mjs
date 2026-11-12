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
  assert.match(output, /<th>Calls\/sample<\/th>/);
  assert.match(output, /Profile and browser captures/);
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
    const htmlOutput = await readFile(htmlPath, "utf8"), markdownOutput = await readFile(markdownPath, "utf8");
    assert.match(htmlOutput, /viewBox="0 0/);
    assert.match(htmlOutput, /1234567/);
    assert.match(markdownOutput, /synthetic\.parse/);
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
