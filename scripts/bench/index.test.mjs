import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCaseDefinitions } from "./cases.mjs";
import { parseBenchArguments, summarizeSamples } from "./index.mjs";
import { driftPercent } from "./stats.mjs";

test("legacy benchmark definitions retain twelve stable cases", async () => {
  const definitions = await getCaseDefinitions({ root: process.cwd() });
  const legacyIds = [
    "bdmv.index-uhd.parse", "bdmv.movieobject-tamako.parse", "bdmv.playlist-tamako.parse", "bdmv.clipinfo-uhd.parse", "bdmv.sound-synthetic.parse",
    "graph.tamako.build", "mnu.battle-royale-00002.parse", "mnu.battle-royale-00002.render", "pgs.real-subtitle.parse", "pgs.real-subtitle.compose",
    "pgs.synthetic-32-128x72.parse", "pgs.synthetic-32-128x72.compose",
  ];
  const legacy = definitions.filter((item) => legacyIds.includes(item.caseId));
  assert.equal(legacy.length, 12);
  assert.equal(new Set(legacy.map((item) => item.caseId)).size, 12);
  assert.ok(legacy.every((item) => item.fixture.id && item.fixture.version && item.category && item.sample));
  assert.deepEqual(legacy.map((item) => item.caseId), legacyIds);
});

test("performance manifest cases resolve inputs under fixtureRoot", async () => {
  const fixtureRoot = process.cwd(), codeRoot = await mkdtemp(join(tmpdir(), "bdmv2web-bench-root-"));
  try {
    const definitions = await getCaseDefinitions({ root: codeRoot, fixtureRoot });
    const perf = definitions.filter((item) => item.caseId.startsWith("perf."));
    assert.ok(perf.length >= 9);
    assert.ok(perf.every((item) => item.fixtureRoot === fixtureRoot));
    assert.ok(perf.filter((item) => item.options.file).every((item) => item.options.file.startsWith(fixtureRoot)));
    const graph = perf.find((item) => item.category === "graph");
    assert.ok(graph.options.files.length > 0);
    assert.ok(graph.options.files.every((file) => file.path.startsWith(fixtureRoot) && file.virtualPath.startsWith("BDMV/")));
    assert.ok(graph.options.files.every((file) => file.sourcePath));
    assert.deepEqual(graph.options.expected, { nodes: 1216, edges: 8110 });
    const playlist = perf.find((item) => item.caseId === "perf.playlist.heavy.parse");
    assert.equal(playlist.options.bdmvRelativePath, "BDMV/PLAYLIST/00003.mpls");
    assert.equal(playlist.options.expected.id, "00003");
    const clipInfo = perf.find((item) => item.caseId === "perf.clipinfo.cpi-heavy.parse");
    assert.equal(clipInfo.options.bdmvRelativePath, "BDMV/CLIPINF/00004.clpi");
    assert.equal(clipInfo.options.expected.id, "00004");
    const igsParse = perf.find((item) => item.caseId === "perf.igs.battle-royale.parse");
    assert.deepEqual(igsParse.options.expected, { status: "complete", scenes: 1, pages: 21, objects: 215, palettes: 21 });
    const render = perf.find((item) => item.caseId === "perf.igs.battle-royale.render");
    assert.equal(render.options.expectedRender.assets, 215);
    const compose = perf.find((item) => item.caseId === "perf.pgs.baja.compose");
    assert.deepEqual(compose.options.expectedCompose, { visible: true, width: 1920, height: 1080 });
  } finally { await rm(codeRoot, { recursive: true, force: true }); }
});

test("benchmark CLI preserves legacy filters and supports explicit budgets", () => {
  const parsed = parseBenchArguments(["--only", "bdmv,pgs", "--case", "pgs.synthetic-32-128x72.parse", "--forks", "2", "--warmup-ms", "0", "--time-ms", "1", "--min-samples", "1", "--calls-per-sample", "8", "--out", "tmp"]);
  assert.deepEqual([...parsed.only], ["bdmv", "pgs"]);
  assert.deepEqual(parsed.cases, ["pgs.synthetic-32-128x72.parse"]);
  assert.equal(parsed.forks, 2);
  assert.equal(parsed.warmupMs, 0);
  assert.equal(parsed.timeMs, 1);
  assert.equal(parsed.minSamples, 1);
  assert.equal(parsed.callsPerSample, 8);
  assert.equal(parseBenchArguments([]).callsPerSample, undefined);
  assert.throws(() => parseBenchArguments(["--calls-per-sample", "0"]), /calls-per-sample/);
});

test("benchmark parser clones case arguments and normalizes category filters", () => {
  const a = parseBenchArguments(["--only", " bdmv, pgs ", "--node-arg", "--jitless", "--node-arg", "--trace-gc"]);
  const b = parseBenchArguments([]);
  assert.deepEqual([...a.only], ["bdmv", "pgs"]);
  assert.deepEqual(a.nodeArgs, ["--jitless", "--trace-gc"]);
  assert.deepEqual(b.cases, []);
  assert.notEqual(a.cases, b.cases);
  assert.throws(() => parseBenchArguments(["--node-arg", "--eval=process.exit()"]), /Unsupported --node-arg/);
});

test("fork summary reports per-call distribution statistics", () => {
  assert.deepEqual(summarizeSamples([1, 3, 2]), {
    min: 1, max: 3, mean: 2, median: 2, p90: 2.8, p95: 2.9, p99: 2.98,
    deviation: Math.sqrt(2 / 3), cvPercent: Math.sqrt(2 / 3) / 2 * 100,
    mad: 1, iqr: 1, outlierCount: 0, outlierPercent: 0, throughputPerSecond: 500, driftPercent: null, sampleCount: 3,
  });
});

test("drift compares the first and last fifth of the window", () => {
  const flat = [...Array(10).fill(1)];
  assert.equal(driftPercent(flat), 0);
  const slowing = [...Array(5).fill(1), ...Array(5).fill(3)];
  assert.equal(Math.round(driftPercent(slowing)), 100);
  assert.equal(driftPercent([1, 2, 3]), null);
});

test("fork summary counts samples outside the interquartile fence", () => {
  const summary = summarizeSamples([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 10]);
  assert.equal(summary.iqr, 0);
  assert.equal(summary.outlierCount, 1);
  assert.equal(summary.outlierPercent, 100 / 11);
});

test("fork summary handles large Tinybench sample arrays", () => {
  const values = new Array(200_000).fill(0.25);
  const summary = summarizeSamples(values);
  assert.equal(summary.sampleCount, 200_000);
  assert.equal(summary.median, 0.25);
});
