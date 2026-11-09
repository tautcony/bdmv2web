#!/usr/bin/env node
/**
 * BDMV2Web parser / graphics benchmark (Node.js >= 24.18).
 *
 * Quick start:
 *   1. Edit only CONFIG.inputs below to change benchmark samples.
 *   2. Put this file at scripts/bench/parser-benchmark.mjs in the repository.
 *   3. Ensure the parser benchmark entry points are exported, then run pnpm build.
 *   4. node scripts/bench/parser-benchmark.mjs
 *
 * From another location:
 *   node parser_benchmark.mjs --root /path/to/bdmv2web
 *
 * Useful flags:
 *   --list                 Show configured inputs without loading project modules.
 *   --only bdmv,pgs       Run specified categories (bdmv, graph, mnu, pgs).
 *   --no-json             Print Markdown only.
 *   --help                Show usage.
 *
 * Input reading, extraction of MNU from TS, full-disc parsing for Graph, and
 * preparation of the PGS display set are deliberately outside timed calls.
 * Repeated operations reuse the same in-memory inputs: this is a WARM-cache
 * component benchmark, not an end-to-end or cold-start benchmark.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ============================================================================
// USER CONFIGURATION -- change sample paths here; no need to edit test logic.
// All relative paths are resolved from repository root; absolute paths work too.
// required=false means ONLY a missing file may be skipped. An invalid present
// file is always a failure. Set tests to independently select each test type.
// ============================================================================
const CONFIG = {
  projectRoot: null, // null = scripts/bench/../..; can override with --root or BDMV2WEB_ROOT
  measurement: {
    warmupRuns: 5,
    measuredRuns: 15,
    // Only very fast operations are batched. Keeping >=1 ms operations at one
    // call per sample avoids turning allocation-heavy parsers/renderers into an
    // artificial GC stress test.
    batchBelowMs: 1,
    targetBatchMs: 50,
    maxBatchIterations: 100_000,
    gcBeforeEachCase: false, // Requires node --expose-gc; optional only.
    gcAfterCalibration: false, // Same requirement; disabled for normal runs.
  },
  output: {
    jsonFile: "test-data/bench/parser-benchmark.json", // Set null to disable.
  },
  inputs: {
    // BDMV standalone parse: kinds = index / movieObject / playlist / clipInfo / sound.
    // If file is outside a BDMV directory, set bdmvRelativePath explicitly (for example PLAYLIST/00003.mpls).
    bdmv: [
      { name: "index-uhd", kind: "index", file: "test-data/fixtures/hdmv-navigation/disc-data/battle-royale-uhd/BDMV/index.bdmv" },
      { name: "movieObject-tamako", kind: "movieObject", file: "test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV/MovieObject.bdmv" },
      { name: "playlist-tamako", kind: "playlist", file: "test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV/PLAYLIST/00003.mpls" },
      { name: "clipInfo-uhd", kind: "clipInfo", file: "test-data/fixtures/hdmv-navigation/disc-data/battle-royale-uhd/BDMV/CLIPINF/00004.clpi" },
      { name: "sound-synthetic", kind: "sound", file: "test-data/fixtures/synthetic-all-features/BDMV/AUXDATA/sound.bdmv", maxReadBytes: 8 * 1024 * 1024 },
    ],
    // Graph is measured alone, with the complete disc pre-parsed OUTSIDE timing.
    graph: [
      { name: "tamako-graph", bdmvDir: "test-data/fixtures/hdmv-navigation/disc-data/tamako/BDMV" },
    ],
    // MNU may be a .mnu file (source="mnu") or filtered TS packet file
    // (source="ig-packets"). For separate parse and PNG samples, add two rows
    // and choose tests: ["parse"] or ["render"].
    mnu: [
      {
        name: "battle-royale-00002", source: "ig-packets",
        file: "test-data/fixtures/hdmv-navigation/disc-data/battle-royale-uhd/BDMV/STREAM/00002.m2ts_ig-packets.bin",
        clipId: "00002", pid: 0x1400, tests: ["parse", "render"], chunkBytes: 4093,
      },
      // { name: "my-mnu", source: "mnu", file: "/absolute/path/input.mnu", clipId: "00001", pid: 0x1400, tests: ["parse", "render"] },
    ],
    // Each PGS row explicitly chooses its input. No implicit "largest local SUP"
    // fallback, because that would make cross-machine results incomparable.
    // displaySet: "largest" (by bitmap pixels), or a 1-based integer.
    pgs: [
      {
        name: "real-subtitle", source: "file",
        file: "test-data/output/baja-studio-pgs/assets/subtitles/subtitle-00001-jpn.sup",
        displaySet: "largest", tests: ["parse", "compose"], required: false,
      },
      {
        name: "synthetic-32-128x72", source: "synthetic",
        displaySetCount: 32, width: 128, height: 72,
        canvasWidth: 1920, canvasHeight: 1080,
        displaySet: "largest", tests: ["parse", "compose"],
      },
      // { name: "custom-subtitle", source: "file", file: "/path/to/example.sup", displaySet: 83, tests: ["parse", "compose"] },
    ],
  },
};
// ======================= END USER CONFIGURATION =============================

const args = process.argv.slice(2);
function parseArguments(argv) {
  const parsed = { root: null, only: null, list: false, json: true, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root") {
      if (!argv[i + 1]) throw new Error("--root requires a directory");
      parsed.root = argv[++i];
    } else if (arg === "--only") {
      if (!argv[i + 1]) throw new Error("--only requires comma-separated categories");
      parsed.only = new Set(argv[++i].split(",").map((s) => s.trim()).filter(Boolean));
    } else if (arg === "--no-json") parsed.json = false;
    else if (arg === "--list") parsed.list = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  const categories = new Set(["bdmv", "graph", "mnu", "pgs"]);
  for (const category of parsed.only ?? []) if (!categories.has(category)) throw new Error(`Unknown benchmark category: ${category}`);
  return parsed;
}
const cli = parseArguments(args);
if (cli.help) {
  process.stdout.write("Usage: node scripts/bench/parser-benchmark.mjs [--root DIR] [--only bdmv,graph,mnu,pgs] [--list] [--no-json]\nEdit CONFIG.inputs near the top to change sample files.\n");
  process.exit(0);
}
const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(cli.root ?? process.env.BDMV2WEB_ROOT ?? CONFIG.projectRoot ?? join(scriptDir, "../.."));
const selected = (category) => !cli.only || cli.only.has(category);
const toPath = (file) => isAbsolute(file) ? file : resolve(root, file);
const pathLabel = (path) => {
  const fromRoot = relative(root, path).replaceAll("\\", "/");
  return fromRoot.startsWith("../") || fromRoot === ".." ? path : fromRoot;
};
function configuredInputs() {
  return Object.entries(CONFIG.inputs).filter(([category]) => selected(category)).flatMap(([category, items]) => items.map((item) => ({ category, name: item.name, source: item.source ?? item.kind ?? "BDMV", input: item.file ?? item.bdmvDir ?? "(generated)", tests: item.tests ?? ["parse"], required: item.required !== false })));
}
if (cli.list) {
  process.stdout.write(`Repository root: ${root}\n`);
  for (const input of configuredInputs()) process.stdout.write(`${input.category.padEnd(5)} ${input.name.padEnd(27)} ${String(input.tests).padEnd(13)} ${input.input}${input.required ? "" : "  [optional]"}\n`);
  process.exit(0);
}

function validateMeasurementConfig() {
  const m = CONFIG.measurement;
  const positive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
  if (!Number.isInteger(m.warmupRuns) || m.warmupRuns < 0) throw new Error("measurement.warmupRuns must be a non-negative integer");
  if (!Number.isInteger(m.measuredRuns) || m.measuredRuns < 1) throw new Error("measurement.measuredRuns must be a positive integer");
  if (!positive(m.batchBelowMs) || !positive(m.targetBatchMs)) throw new Error("measurement.batchBelowMs/targetBatchMs must be positive numbers");
  if (!Number.isInteger(m.maxBatchIterations) || m.maxBatchIterations < 1) throw new Error("measurement.maxBatchIterations must be a positive integer");
}
validateMeasurementConfig();

// Load only modules required by the selected benchmark categories. This keeps
// --only useful while working on a single package and avoids unrelated dist
// artifacts becoming prerequisites.
const modules = {};
const fromDist = async (key, path) => {
  const fullPath = join(root, path);
  if (!existsSync(fullPath)) throw new Error(`Missing ${path} under ${root}. Run pnpm build for the selected package(s) first.`);
  modules[key] = await import(pathToFileURL(fullPath).href);
};
if (selected("bdmv") || selected("graph")) await fromDist("parserSteps", "packages/bdmv-parser/dist/parser.js");
if (selected("graph")) await fromDist("parser", "packages/bdmv-parser/dist/index.js");
if (selected("mnu")) {
  await Promise.all([
    fromDist("igsExtract", "packages/igs/dist/extract.js"),
    fromDist("igsMnu", "packages/igs/dist/mnu.js"),
    fromDist("igsPng", "packages/igs/dist/png.js"),
  ]);
}
if (selected("pgs")) {
  await Promise.all([
    fromDist("pgs", "packages/media-export/dist/pgs.js"),
    fromDist("pgsRender", "packages/media-export/dist/pgs-render.js"),
  ]);
}
const { parser, parserSteps, igsExtract, igsMnu, igsPng, pgs, pgsRender } = modules;

if (selected("bdmv")) {
  const byKind = { index: "parseIndex", movieObject: "parseMobj", playlist: "parseMpls", clipInfo: "parseClpi", sound: "parseSound" };
  const needed = [...new Set(CONFIG.inputs.bdmv.map((item) => byKind[item.kind]).filter(Boolean))];
  const missing = needed.filter((fn) => typeof parserSteps?.[fn] !== "function");
  if (missing.length) throw new Error(`Internal BDMV benchmark entry points are not exported (${missing.join(", ")}). Export them from packages/bdmv-parser/src/parser.ts and rebuild.`);
}
if (selected("graph") && typeof parserSteps?.buildGraph !== "function") {
  throw new Error("Internal graph benchmark entry point buildGraph is not exported. Export it from packages/bdmv-parser/src/parser.ts and rebuild.");
}

const rows = [];
const skipped = [];
const failures = [];
const caseNames = new Set();

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function sourceInfo(file, bytes, fullLength = bytes.byteLength) {
  const digest = sha256(bytes);
  return {
    path: pathLabel(file),
    sourceBytes: fullLength,
    bytesRead: bytes.byteLength,
    // sha256 is only a whole-file identity when the whole file was read.
    sha256: bytes.byteLength === fullLength ? digest : null,
    sha256ReadBytes: digest,
    hashScope: bytes.byteLength === fullLength ? "full-file" : `prefix:${bytes.byteLength}`,
  };
}
async function readBytes(file, maxReadBytes = Number.MAX_SAFE_INTEGER) {
  const fullLength = (await stat(file)).size;
  if (maxReadBytes >= fullLength) return { bytes: new Uint8Array(await readFile(file)), fullLength };
  // Needed for unusually large AUXDATA/sound.bdmv: parse only its metadata prefix.
  const { open } = await import("node:fs/promises");
  const handle = await open(file, "r");
  try {
    const target = Buffer.alloc(Math.min(fullLength, maxReadBytes));
    let offset = 0;
    while (offset < target.length) {
      const { bytesRead } = await handle.read(target, offset, target.length - offset, offset);
      if (!bytesRead) throw new Error(`Unexpected EOF at ${offset} in ${file}`);
      offset += bytesRead;
    }
    return { bytes: new Uint8Array(target), fullLength };
  } finally { await handle.close(); }
}
function isMissing(err) { return err?.code === "ENOENT" || err?.code === "ENOTDIR"; }
async function withSample(category, item, prepare) {
  const name = `${category}/${item.name}`;
  if (caseNames.has(name)) throw new Error(`Duplicate benchmark sample name: ${name}`);
  caseNames.add(name);
  try { await prepare(); }
  catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    if (item.required === false && isMissing(error)) {
      skipped.push({ case: name, reason: `Optional input absent: ${error.path ?? ""}`.trim() });
    } else {
      failures.push({ case: name, reason: message });
      process.stderr.write(`[FAIL] ${name}: ${message}\n`);
    }
  }
}
function checkTests(item, supported) {
  const names = item.tests ?? supported;
  if (!Array.isArray(names) || names.length === 0 || names.some((name) => !supported.includes(name))) throw new Error(`Invalid tests for ${item.name}; expected subset of ${supported.join(", ")}`);
  if (new Set(names).size !== names.length) throw new Error(`Duplicate tests for ${item.name}`);
  return names;
}

function percentile(sorted, p) {
  if (sorted.length === 1) return sorted[0];
  const at = (sorted.length - 1) * p;
  const low = Math.floor(at), high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}
function sampleStatistics(samples) {
  const ordered = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const deviation = Math.sqrt(samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length);
  return { min: ordered[0], mean, median: percentile(ordered, 0.5), p95: percentile(ordered, 0.95), max: ordered.at(-1), deviation, cvPercent: mean === 0 ? 0 : deviation / mean * 100 };
}
function timeBatch(run, iterations) {
  const start = process.hrtime.bigint();
  let last;
  for (let i = 0; i < iterations; i++) {
    last = run();
    if (last && typeof last.then === "function") throw new TypeError("Benchmark operation returned a Promise; timeBatch only supports synchronous operations.");
  }
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { ms, last };
}
function calibrateBatch(run) {
  const { batchBelowMs, targetBatchMs, maxBatchIterations } = CONFIG.measurement;
  // Median of three single-call probes is enough to decide whether batching is
  // needed. Operations >= batchBelowMs stay at batch=1 to preserve their normal
  // allocation/GC shape.
  const probes = [timeBatch(run, 1).ms, timeBatch(run, 1).ms, timeBatch(run, 1).ms].sort((a, b) => a - b);
  const singleMs = probes[1];
  if (singleMs >= batchBelowMs) return { iterations: 1, singleProbeMs: singleMs, batchMs: singleMs, targetReached: true, hitMaxBatch: false };
  let batch = 1;
  for (;;) {
    const elapsed = timeBatch(run, batch).ms;
    if (elapsed >= targetBatchMs * 0.8 || batch === maxBatchIterations) return {
      iterations: batch, singleProbeMs: singleMs, batchMs: elapsed,
      targetReached: elapsed >= targetBatchMs * 0.8, hitMaxBatch: batch === maxBatchIterations,
    };
    const next = elapsed < 0.1 ? batch * 8 : Math.ceil(batch * Math.min(8, targetBatchMs / Math.max(elapsed, 0.001)));
    batch = Math.min(maxBatchIterations, Math.max(batch + 1, next));
  }
}
function measure({ category, name, sample, input, timedInputBytes = null, run, describe, extra = {} }) {
  if (CONFIG.measurement.gcBeforeEachCase && globalThis.gc) globalThis.gc();
  const warmups = CONFIG.measurement.warmupRuns;
  const repeats = CONFIG.measurement.measuredRuns;
  for (let i = 0; i < warmups; i++) run();
  const before = describe(run()); // OUTSIDE timed region.
  const calibration = calibrateBatch(run);
  const iterations = calibration.iterations;
  if (CONFIG.measurement.gcAfterCalibration && globalThis.gc) globalThis.gc();
  const timings = [];
  const rssAfter = [];
  let last;
  for (let i = 0; i < repeats; i++) {
    const measured = timeBatch(run, iterations);
    last = measured.last;
    timings.push(measured.ms / iterations);
    rssAfter.push(process.memoryUsage().rss);
  }
  const after = describe(last); // OUTSIDE timed region.
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`Non-repeatable result in ${name}: ${JSON.stringify(before)} != ${JSON.stringify(after)}`);
  const stats = sampleStatistics(timings);
  const units = after.units ?? null;
  const workPerSecond = units?.value ? units.value * 1000 / stats.median : null;
  const inputMiBPerSecond = timedInputBytes && stats.median > 0 ? (timedInputBytes / (1024 * 1024)) / (stats.median / 1000) : null;
  rows.push({
    category, name, sample, input, timedInputBytes, output: after.summary, result: after.details ?? null,
    iterations, measuredRuns: repeats, stats, units, workPerSecond, inputMiBPerSecond,
    calibration, rawMsPerCall: timings, rssAfter, ...extra,
  });
  const calibrationWarning = calibration.targetReached ? "" : " [calibration target not reached]";
  process.stderr.write(`[OK] ${name}: p50=${stats.median.toFixed(3)}ms, CV=${stats.cvPercent.toFixed(1)}%, batch=${iterations}${calibrationWarning}\n`);
}
function countPixels(displaySet) {
  let n = 0;
  for (const bitmap of displaySet.bitmaps.values()) n += bitmap.width * bitmap.height;
  return n;
}
function describeBdmv(kind, parsed) {
  const value = kind === "sound" ? parsed : parsed.value;
  let details;
  if (kind === "index") details = { entries: value.entries.length, appInfo: !!value.appInfo, uhd: !!value.uhd };
  else if (kind === "movieObject") details = { objects: value.length, instructions: value.reduce((sum, item) => sum + item.instructions.length, 0) };
  else if (kind === "playlist") details = { playItems: value.playItems.length, marks: value.marks.length, subPaths: value.subPaths.length };
  else if (kind === "clipInfo") details = { atcs: value.sequence.length, programs: value.programs.length, streams: value.programs.reduce((sum, item) => sum + item.streams.length, 0), cpiEntries: value.cpi.length };
  else details = { soundEntries: value.length };
  const units = kind === "index" ? { value: details.entries, unit: "index entries" }
    : kind === "movieObject" ? { value: details.instructions, unit: "instructions" }
      : kind === "playlist" ? { value: details.playItems, unit: "PlayItems" }
        : kind === "clipInfo" ? { value: details.cpiEntries, unit: "CPI entries" }
          : { value: details.soundEntries, unit: "sound entries" };
  return { summary: Object.entries(details).map(([k, v]) => `${k}=${v}`).join("; "), details, units };
}
function describeMnu(result) {
  const details = {
    status: result.status, scenes: result.scenes.length,
    pages: result.scenes.reduce((sum, scene) => sum + scene.pages.length, 0),
    objects: result.scenes.reduce((sum, scene) => sum + scene.objects.length, 0),
    palettes: result.scenes.reduce((sum, scene) => sum + scene.palettes.length, 0),
    diagnostics: result.diagnostics.length,
  };
  return { summary: Object.entries(details).map(([k, v]) => `${k}=${v}`).join("; "), details, units: { value: details.objects, unit: "IGS objects" } };
}
function describeIgsPng(result) {
  const details = { assets: result.assets.length, pngBytes: 0, pixels: 0, errors: result.diagnostics.filter((d) => d.severity === "error").length };
  for (const asset of result.assets) { details.pngBytes += asset.pngBytes.byteLength; details.pixels += asset.width * asset.height; }
  return { summary: `assets=${details.assets}; pngBytes=${details.pngBytes}; pixels=${details.pixels}; errors=${details.errors}`, details, units: { value: details.pixels, unit: "rendered pixels" } };
}
function describePgs(result) {
  const details = { displaySets: result.length, bitmaps: 0, decodedPixels: 0 };
  for (const set of result) for (const bitmap of set.bitmaps.values()) { details.bitmaps++; details.decodedPixels += bitmap.width * bitmap.height; }
  return { summary: `displaySets=${details.displaySets}; bitmaps=${details.bitmaps}; decodedPixels=${details.decodedPixels}`, details, units: { value: details.decodedPixels, unit: "decoded pixels" } };
}
function describePgsRender(result) {
  const details = { visible: result.visible, pngBytes: result.pngBytes.byteLength, width: result.width, height: result.height };
  return { summary: `visible=${details.visible}; pngBytes=${details.pngBytes}; canvas=${details.width}x${details.height}`, details, units: { value: details.width * details.height, unit: "canvas pixels" } };
}
function checkExpected(actual, expected, context) {
  if (expected === undefined) return;
  for (const [key, value] of Object.entries(expected)) if (actual[key] !== value) throw new Error(`${context}: expected ${key}=${value}, got ${actual[key]}`);
}
function inferBdmvRelative(file) {
  const parts = file.replaceAll("\\", "/").split("/");
  const bdmvAt = parts.findLastIndex((p) => p.toUpperCase() === "BDMV");
  if (bdmvAt < 0 || bdmvAt === parts.length - 1) throw new Error(`BDMV sample path must be inside a BDMV directory: ${file}`);
  return parts.slice(bdmvAt + 1).join("/");
}
function entry(relativeFile, absoluteFile, fullLength) {
  return { rel: `BDMV/${relativeFile.replace(/^BDMV\//i, "")}`, abs: absoluteFile, size: fullLength };
}
function parseSingleBdmv(kind, bytes, fileEntry, fullLength) {
  switch (kind) {
    case "index": return parserSteps.parseIndex(bytes, fileEntry, "primary");
    case "movieObject": return parserSteps.parseMobj(bytes, fileEntry, "primary");
    case "playlist": return parserSteps.parseMpls(bytes, fileEntry, "primary");
    case "clipInfo": return parserSteps.parseClpi(bytes, fileEntry, "primary");
    case "sound": return parserSteps.parseSound(bytes, fileEntry, fullLength);
    default: throw new Error(`Unknown BDMV kind: ${kind}`);
  }
}
async function walkFiles(directory) {
  const output = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) output.push(...await walkFiles(path));
    else if (item.isFile()) output.push(path);
  }
  return output.sort((a, b) => a.localeCompare(b, "en"));
}
async function* chunks(bytes, chunkBytes) {
  for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) yield bytes.subarray(offset, Math.min(offset + chunkBytes, bytes.byteLength));
}
function putU16(bytes, offset, value) { bytes[offset] = value >>> 8; bytes[offset + 1] = value; }
function putU24(bytes, offset, value) { bytes[offset] = value >>> 16; bytes[offset + 1] = value >>> 8; bytes[offset + 2] = value; }
function putU32(bytes, offset, value) { bytes[offset] = value >>> 24; bytes[offset + 1] = value >>> 16; bytes[offset + 2] = value >>> 8; bytes[offset + 3] = value; }
function concatenate(parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) { result.set(part, at); at += part.byteLength; }
  return result;
}
function pgsSegment(pts, type, payload) {
  const bytes = new Uint8Array(13 + payload.length);
  bytes[0] = 0x50; bytes[1] = 0x47;
  putU32(bytes, 2, pts >>> 0); putU32(bytes, 6, pts >>> 0);
  bytes[10] = type; putU16(bytes, 11, payload.length); bytes.set(payload, 13);
  return bytes;
}
function syntheticPgsSup({ displaySetCount, width, height, canvasWidth = 1920, canvasHeight = 1080 }) {
  if (!Number.isInteger(displaySetCount) || displaySetCount < 1 || displaySetCount > 65_000) throw new RangeError("Invalid displaySetCount");
  if (!Number.isInteger(width) || width < 2 || width % 2 !== 0 || width / 2 > 16_383 || !Number.isInteger(height) || height < 1 || height > 1080) throw new RangeError("Synthetic bitmap must have a positive even width and height <= 1080");
  if (!Number.isInteger(canvasWidth) || canvasWidth < width + 100 || canvasWidth > 65_535 || !Number.isInteger(canvasHeight) || canvasHeight < height + 100 || canvasHeight > 65_535) throw new RangeError("Synthetic PGS canvas must contain the bitmap at placement (100,100) and fit in 16 bits");
  const parts = [pgsSegment(0, 0x14, Uint8Array.from([0, 0, 1, 235, 128, 128, 255, 2, 81, 128, 128, 255]))];
  const half = width / 2;
  const encoded = new Uint8Array(height * 10);
  for (let y = 0; y < height; y++) encoded.set([0, 0xc0 | (half >>> 8), half & 0xff, 1, 0, 0xc0 | (half >>> 8), half & 0xff, 2, 0, 0], y * 10);
  for (let index = 0; index < displaySetCount; index++) {
    const objectId = index + 1;
    const object = new Uint8Array(11 + encoded.length);
    putU16(object, 0, objectId); object[3] = 0xc0;
    putU24(object, 4, 4 + encoded.length); putU16(object, 7, width); putU16(object, 9, height);
    object.set(encoded, 11); parts.push(pgsSegment(index * 90_000, 0x15, object));
    const composition = new Uint8Array(19);
    putU16(composition, 0, canvasWidth); putU16(composition, 2, canvasHeight);
    composition[4] = 0x10; putU16(composition, 5, index + 1);
    composition[7] = index === 0 ? 0x80 : 0;
    composition[10] = 1; putU16(composition, 11, objectId);
    putU16(composition, 15, 100); putU16(composition, 17, 100);
    parts.push(pgsSegment(index * 90_000, 0x16, composition));
    parts.push(pgsSegment(index * 90_000, 0x80, new Uint8Array()));
  }
  return concatenate(parts);
}

for (const item of CONFIG.inputs.bdmv) if (selected("bdmv")) {
  await withSample("bdmv", item, async () => {
    const kind = item.kind;
    if (!["index", "movieObject", "playlist", "clipInfo", "sound"].includes(kind)) throw new Error(`Invalid BDMV kind: ${kind}`);
    const file = toPath(item.file);
    const { bytes, fullLength } = await readBytes(file, item.maxReadBytes);
    const relativeFile = item.bdmvRelativePath ?? inferBdmvRelative(file);
    const fileEntry = entry(relativeFile, file, fullLength);
    const run = () => parseSingleBdmv(kind, bytes, fileEntry, fullLength);
    const info = describeBdmv(kind, run());
    checkExpected(info.details, item.expected, item.name);
    measure({ category: "bdmv", name: `BDMV ${kind}`, sample: item.name, input: sourceInfo(file, bytes, fullLength), timedInputBytes: bytes.byteLength, run, describe: (value) => describeBdmv(kind, value) });
  });
}

for (const item of CONFIG.inputs.graph) if (selected("graph")) {
  await withSample("graph", item, async () => {
    const bdmvDir = toPath(item.bdmvDir);
    const parsed = await parser.parseBdmv(bdmvDir);
    const graphPaths = await walkFiles(bdmvDir);
    const files = await Promise.all(graphPaths.map(async (path) => ({
      rel: `BDMV/${relative(bdmvDir, path).replaceAll("\\", "/")}`,
      abs: path,
      size: (await stat(path)).size,
    })));
    const run = () => parserSteps.buildGraph(parsed.entries, parsed.movieObjects, parsed.playlists, parsed.clips, parsed.sounds, files, []);
    const describe = (graph) => {
      const details = { nodes: graph.nodes.length, edges: graph.edges.length };
      return { summary: `nodes=${details.nodes}; edges=${details.edges}`, details, units: { value: details.nodes + details.edges, unit: "graph elements" } };
    };
    checkExpected(describe(run()).details, item.expected, item.name);
    measure({ category: "graph", name: "BDMV graph build", sample: item.name, input: { path: pathLabel(bdmvDir), fileCount: files.length, preParsed: true }, run, describe });
  });
}

for (const item of CONFIG.inputs.mnu) if (selected("mnu")) {
  await withSample("mnu", item, async () => {
    const tests = checkTests(item, ["parse", "render"]);
    const file = toPath(item.file);
    const { bytes: sourceBytes } = await readBytes(file);
    let streamBytes;
    if (item.source === "mnu") streamBytes = sourceBytes;
    else if (item.source === "ig-packets") {
      if (!Number.isInteger(item.pid) || item.pid < 0 || item.pid > 0x1fff) throw new Error(`Invalid PID for ${item.name}`);
      const result = await igsExtract.extractIgsFromChunks(item.clipId, chunks(sourceBytes, item.chunkBytes ?? 4093), [{ pid: item.pid, source: { path: `BDMV/CLIPINF/${item.clipId}.clpi`, origin: "primary", offset: "0" } }], { captureStreams: true, renderAssets: false });
      const stream = result.streams.find((candidate) => candidate.pid === item.pid);
      if (!stream?.bytes) throw new Error(`No MNU stream for ${item.name} at PID ${item.pid}`);
      streamBytes = stream.bytes;
    } else throw new Error(`Unsupported MNU source '${item.source}'`);
    const runParse = () => igsMnu.parseIgsMnu(streamBytes, { clipId: item.clipId, pid: item.pid, renderAssets: false });
    const baseline = runParse();
    const detail = describeMnu(baseline);
    checkExpected(detail.details, item.expected, item.name);
    const input = { ...sourceInfo(file, sourceBytes), mnuBytes: streamBytes.byteLength, mnuSha256: sha256(streamBytes), sourceType: item.source, clipId: item.clipId, pid: item.pid };
    if (tests.includes("parse")) measure({ category: "mnu", name: "MNU parse", sample: item.name, input, timedInputBytes: streamBytes.byteLength, run: runParse, describe: describeMnu });
    if (tests.includes("render")) {
      // Separate pre-parsed input per case. Rendering is not allowed to alter
      // the normalized scene summary (scene.complete can be changed on errors).
      const prepared = runParse();
      const before = describeMnu(prepared);
      const run = () => igsPng.renderIgsAssets(prepared.scenes);
      const rendered = describeIgsPng(run());
      if (rendered.details.errors) throw new Error(`${item.name}: rendering emitted ${rendered.details.errors} diagnostics`);
      checkExpected(rendered.details, item.expectedRender, item.name);
      if (JSON.stringify(before) !== JSON.stringify(describeMnu(prepared))) throw new Error(`${item.name}: rendering modified pre-parsed scene state`);
      measure({ category: "mnu", name: "MNU render assets", sample: item.name, input, run, describe: describeIgsPng });
    }
  });
}

for (const item of CONFIG.inputs.pgs) if (selected("pgs")) {
  await withSample("pgs", item, async () => {
    const tests = checkTests(item, ["parse", "compose"]);
    let bytes, input;
    if (item.source === "synthetic") {
      bytes = syntheticPgsSup(item);
      input = { generated: true, source: "synthetic", sourceBytes: bytes.byteLength, sha256: sha256(bytes), displaySetCount: item.displaySetCount, bitmapWidth: item.width, bitmapHeight: item.height, canvasWidth: item.canvasWidth ?? 1920, canvasHeight: item.canvasHeight ?? 1080 };
    } else if (item.source === "file") {
      const file = toPath(item.file);
      ({ bytes } = await readBytes(file));
      input = sourceInfo(file, bytes);
    } else throw new Error(`Unsupported PGS source '${item.source}'`);
    const runParse = () => pgs.parsePgsSup(bytes);
    const parsed = runParse();
    checkExpected(describePgs(parsed).details, item.expected, item.name);
    if (tests.includes("parse")) measure({ category: "pgs", name: "PGS parse and bitmap decode", sample: item.name, input, timedInputBytes: bytes.byteLength, run: runParse, describe: describePgs });
    if (tests.includes("compose")) {
      if (!parsed.length) throw new Error(`${item.name}: PGS contains zero display sets`);
      let index;
      if (item.displaySet === "largest" || item.displaySet === undefined) {
        index = 0;
        for (let i = 1; i < parsed.length; i++) if (countPixels(parsed[i]) > countPixels(parsed[index])) index = i;
      } else if (Number.isInteger(item.displaySet) && item.displaySet >= 1 && item.displaySet <= parsed.length) index = item.displaySet - 1;
      else throw new Error(`Invalid 1-based displaySet for ${item.name}: ${item.displaySet}`);
      const displaySet = parsed[index];
      const run = () => pgsRender.renderPgsDisplaySet(displaySet, index + 1, null);
      checkExpected(describePgsRender(run()).details, item.expectedCompose, item.name);
      measure({ category: "pgs", name: "PGS compose and PNG encode", sample: `${item.name} display set ${index + 1}`, input: { ...input, selectedDisplaySet: index + 1, bitmapPixels: countPixels(displaySet), canvasWidth: displaySet.width, canvasHeight: displaySet.height }, run, describe: describePgsRender });
    }
  });
}

const revision = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } })();
const report = {
  title: "BDMV and graphics parser benchmark",
  createdAt: new Date().toISOString(),
  environment: { repositoryRoot: root, revision, node: process.version, v8: process.versions.v8, platform: platform(), release: release(), architecture: arch(), cpus: cpus()[0]?.model ?? null, cpuCount: cpus().length, totalMemoryBytes: totalmem() },
  configuration: { measurement: CONFIG.measurement, categories: [...new Set(rows.map((row) => row.category))], sampleCount: rows.length },
  rows, skipped, failures,
  note: "Warm-cache component timing; input loading and sample preparation excluded. For batch size > 1, percentiles describe per-call averages of timed batches, not single-call tail latency. RSS is process-level after-batch data, not per-operation peak memory.",
};
function ms(value) { return value < 0.01 ? value.toFixed(6) : value.toFixed(3); }
function markdownCell(value) { return String(value).replaceAll("|", "\\|").replaceAll("\n", " "); }
process.stdout.write(`# BDMV and graphics parser benchmark\n\n`);
process.stdout.write(`Repository: ${root}  \nCommit: ${revision?.slice(0, 12) ?? "unknown"}  \nNode: ${process.version}  \n`);
process.stdout.write(`Warm-up: ${CONFIG.measurement.warmupRuns}; measured batches per case: ${CONFIG.measurement.measuredRuns}; batch threshold: <${CONFIG.measurement.batchBelowMs} ms; target batch: ${CONFIG.measurement.targetBatchMs} ms. Values are milliseconds **per operation**. I/O and preparation are outside timed operations. For batch size > 1, P95 is the P95 of batch-average per-call time, not single-call tail latency.\n\n`);
process.stdout.write(`| Case | Sample | Timed input bytes | Parsed/rendered result | Work units | Batch size | Min ms | Mean ms | Median ms | P95 ms | Max ms | Std dev ms | CV % | Work/s | Input MiB/s |\n`);
process.stdout.write(`|---|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n`);
for (const row of rows) {
  const { stats: s } = row;
  const unitsLabel = row.units ? `${row.units.value.toLocaleString("en-US")} ${row.units.unit}` : "—";
  const workPerSecond = row.workPerSecond === null ? "—" : Math.round(row.workPerSecond).toLocaleString("en-US");
  const inputMiBPerSecond = row.inputMiBPerSecond === null ? "—" : row.inputMiBPerSecond.toFixed(2);
  process.stdout.write(`| ${markdownCell(row.name)} | ${markdownCell(row.sample)} | ${row.timedInputBytes ?? "—"} | ${markdownCell(row.output)} | ${markdownCell(unitsLabel)} | ${row.iterations} | ${ms(s.min)} | ${ms(s.mean)} | ${ms(s.median)} | ${ms(s.p95)} | ${ms(s.max)} | ${ms(s.deviation)} | ${s.cvPercent.toFixed(1)} | ${workPerSecond} | ${inputMiBPerSecond} |\n`);
}
if (skipped.length) {
  process.stdout.write(`\n## Optional inputs not found\n\n`);
  for (const item of skipped) process.stdout.write(`- ${markdownCell(item.case)}: ${markdownCell(item.reason)}\n`);
}
if (failures.length) {
  process.stdout.write(`\n## Failed inputs / runs\n\n`);
  for (const item of failures) process.stdout.write(`- **${markdownCell(item.case)}**: ${markdownCell(item.reason.split("\n")[0])}\n`);
}
if (cli.json && CONFIG.output.jsonFile) {
  const dest = toPath(CONFIG.output.jsonFile);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, JSON.stringify(report, null, 2) + "\n");
  process.stderr.write(`JSON report: ${dest}\n`);
}
if (failures.length || !rows.length) process.exitCode = 1;
