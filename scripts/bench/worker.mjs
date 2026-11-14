import { existsSync } from "node:fs";
import { mkdtemp, open, readFile, readdir, rm, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { Bench } from "tinybench";
import { calibrateCallsPerSample } from "./batch.mjs";
import { getCaseDefinitions, resolveInput } from "./cases.mjs";
import { createProgram, exitWithError, integerArgument, numberArgument, parseOptions } from "./cli.mjs";
import { toPortablePath } from "./fixture-input.mjs";
import { normalizeMaxRssBytes, observeGc } from "./memory.mjs";

const moduleCache = new Map();
async function dist(root, key, path) {
  const file = join(root, path);
  const cacheKey = `${file}::${key}`;
  if (!moduleCache.has(cacheKey)) {
    if (!existsSync(file)) throw new Error(`Missing ${path} under ${root}. Run pnpm build for the selected package(s) first.`);
    moduleCache.set(cacheKey, import(pathToFileURL(file).href));
  }
  return moduleCache.get(cacheKey);
}
async function readBounded(file, maxBytes) {
  const fullLength = (await stat(file)).size;
  if (fullLength <= maxBytes) return { bytes: new Uint8Array(await readFile(file)), fullLength };
  const handle = await open(file, "r"), buffer = Buffer.alloc(maxBytes);
  try { let offset = 0; while (offset < buffer.length) { const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset); if (!bytesRead) throw new Error(`Unexpected EOF at ${offset} in ${file}`); offset += bytesRead; } }
  finally { await handle.close(); }
  return { bytes: new Uint8Array(buffer), fullLength };
}
async function walkFiles(dir) {
  const result = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) result.push(...await walkFiles(path));
    else if (item.isFile()) result.push(path);
  }
  return result.sort((a, b) => a.localeCompare(b, "en"));
}
function describe(value, details, unit) {
  return { summary: Object.entries(details).map(([k, v]) => `${k}=${v}`).join("; "), details, ...(unit ? { units: unit } : {}) };
}
function expected(actual, spec, context) {
  for (const [key, value] of Object.entries(spec ?? {})) if (actual[key] !== value) throw new Error(`${context}: expected ${key}=${value}, got ${actual[key]}`);
}
function usefulOutput(description, context) {
  const vals = Object.values(description.details ?? {}).filter((value) => typeof value === "number");
  if (!vals.some((value) => value > 0)) throw new Error(`${context}: operation returned no useful output (${description.summary})`);
}
async function parseMnu(root, options) {
  const [igsExtract, igsMnu] = await Promise.all([
    dist(root, "igsExtract", "packages/igs/dist/scene/extract.js"),
    dist(root, "igsMnu", "packages/igs/dist/rendering/mnu.js"),
  ]);
  const file = resolveInput(root, options.file);
  const source = new Uint8Array(await readFile(file));
  let streamBytes = source;
  if (options.source === "ig-packets") {
    async function* chunks() { for (let at = 0; at < source.length; at += options.chunkBytes) yield source.subarray(at, Math.min(source.length, at + options.chunkBytes)); }
    const extracted = await igsExtract.extractIgsFromChunks(options.clipId, chunks(), [{ pid: options.pid, source: { path: `BDMV/CLIPINF/${options.clipId}.clpi`, origin: "primary", offset: "0" } }], { captureStreams: true, renderAssets: false });
    streamBytes = extracted.streams.find((item) => item.pid === options.pid)?.bytes;
    if (!streamBytes) throw new Error(`No MNU stream at PID ${options.pid}`);
  }
  return { file, source, streamBytes, parse: () => igsMnu.parseIgsMnu(streamBytes, { clipId: options.clipId, pid: options.pid, renderAssets: false }) };
}
function describeMnu(result) {
  const details = { status: result.status, scenes: result.scenes.length, pages: result.scenes.reduce((n, s) => n + s.pages.length, 0), objects: result.scenes.reduce((n, s) => n + s.objects.length, 0), palettes: result.scenes.reduce((n, s) => n + s.palettes.length, 0), diagnostics: result.diagnostics.length };
  return describe(result, details, { value: details.objects, unit: "IGS objects" });
}
function describePgs(result) {
  let bitmaps = 0, decodedPixels = 0;
  for (const set of result) for (const bitmap of set.bitmaps.values()) { bitmaps++; decodedPixels += bitmap.width * bitmap.height; }
  return describe(result, { displaySets: result.length, bitmaps, decodedPixels }, { value: decodedPixels, unit: "decoded pixels" });
}
function countPixels(set) { let n = 0; for (const b of set.bitmaps.values()) n += b.width * b.height; return n; }
function putU16(b, o, v) { b[o] = v >>> 8; b[o + 1] = v; }
function putU24(b, o, v) { b[o] = v >>> 16; b[o + 1] = v >>> 8; b[o + 2] = v; }
function putU32(b, o, v) { b[o] = v >>> 24; b[o + 1] = v >>> 16; b[o + 2] = v >>> 8; b[o + 3] = v; }
function pgsSegment(pts, type, payload) { const b = new Uint8Array(13 + payload.length); b.set([0x50, 0x47]); putU32(b, 2, pts); putU32(b, 6, pts); b[10] = type; putU16(b, 11, payload.length); b.set(payload, 13); return b; }
function syntheticPgs(o) {
  const parts = [pgsSegment(0, 0x14, Uint8Array.from([0, 0, 1, 235, 128, 128, 255, 2, 81, 128, 128, 255]))];
  const half = o.width / 2, encoded = new Uint8Array(o.height * 10);
  for (let y = 0; y < o.height; y++) encoded.set([0, 0xc0 | (half >>> 8), half & 0xff, 1, 0, 0xc0 | (half >>> 8), half & 0xff, 2, 0, 0], y * 10);
  for (let index = 0; index < o.displaySetCount; index++) {
    const id = index + 1, object = new Uint8Array(11 + encoded.length); putU16(object, 0, id); object[3] = 0xc0; putU24(object, 4, 4 + encoded.length); putU16(object, 7, o.width); putU16(object, 9, o.height); object.set(encoded, 11); parts.push(pgsSegment(index * 90000, 0x15, object));
    const comp = new Uint8Array(19); putU16(comp, 0, o.canvasWidth); putU16(comp, 2, o.canvasHeight); comp[4] = 0x10; putU16(comp, 5, index + 1); comp[7] = index === 0 ? 0x80 : 0; comp[10] = 1; putU16(comp, 11, id); putU16(comp, 15, 100); putU16(comp, 17, 100); parts.push(pgsSegment(index * 90000, 0x16, comp), pgsSegment(index * 90000, 0x80, new Uint8Array()));
  }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let at = 0; for (const part of parts) { out.set(part, at); at += part.length; } return out;
}

export async function prepareCase(caseDef, root) {
  if (caseDef.suite === "scenario") {
    const { prepareScenarioCase } = await import("./scenarios.mjs");
    return prepareScenarioCase(caseDef, root);
  }
  const o = caseDef.options ?? {};
  if (caseDef.category === "bdmv") {
    const parserSteps = await dist(root, "parserSteps", "packages/bdmv-parser/dist/parsing/parser.js");
    const path = resolveInput(root, o.file), { bytes, fullLength } = await readBounded(path, o.maxReadBytes ?? Number.MAX_SAFE_INTEGER);
    const kindFns = { index: "parseIndex", movieObject: "parseMobj", playlist: "parseMpls", clipInfo: "parseClpi", sound: "parseSound" };
    const fn = parserSteps[kindFns[o.kind]];
    if (typeof fn !== "function") throw new Error(`Parser build does not export ${kindFns[o.kind]}`);
    const inferredRelativeFile = o.file.split("/").slice(o.file.split("/").findLastIndex((p) => p.toUpperCase() === "BDMV") + 1).join("/");
    const relativeFile = o.bdmvRelativePath?.replace(/^BDMV\//i, "") ?? inferredRelativeFile;
    const fileEntry = { rel: `BDMV/${relativeFile}`, abs: path, size: fullLength };
    const run = () => o.kind === "sound" ? fn(bytes, fileEntry, fullLength) : fn(bytes, fileEntry, "primary");
    const describeValue = (parsed) => {
      const value = o.kind === "sound" ? parsed : parsed.value;
      const d = o.kind === "index" ? { entries: value.entries.length, appInfo: !!value.appInfo, uhd: !!value.uhd }
        : o.kind === "movieObject" ? { objects: value.length, instructions: value.reduce((n, x) => n + x.instructions.length, 0) }
        : o.kind === "playlist" ? { id: value.id, playItems: value.playItems.length, marks: value.marks.length, subPaths: value.subPaths.length }
          : o.kind === "clipInfo" ? { id: value.id, atcs: value.sequence.length, programs: value.programs.length, streams: value.programs.reduce((n, x) => n + x.streams.length, 0), cpiEntries: value.cpi.length }
              : { soundEntries: value.length };
      const units = o.kind === "index" ? [d.entries, "index entries"] : o.kind === "movieObject" ? [d.instructions, "instructions"] : o.kind === "playlist" ? [d.playItems, "PlayItems"] : o.kind === "clipInfo" ? [d.cpiEntries, "CPI entries"] : [d.soundEntries, "sound entries"];
      return describe(parsed, d, { value: units[0], unit: units[1] });
    };
    return { run, validate: (v) => { const d = describeValue(v); expected(d.details, o.expected, caseDef.caseId); usefulOutput(d, caseDef.caseId); }, describe: describeValue, scope: caseDef.scope, input: { path: toPortablePath(root, o.file), sourceBytes: bytes.length, fullLength }, fixture: caseDef.fixture };
  }
  if (caseDef.category === "nav-graph") {
    const [parser, hdmv, mediaExport, igsExtract] = await Promise.all([
      dist(root, "parser", "packages/bdmv-parser/dist/index.js"),
      dist(root, "hdmv", "packages/hdmv/dist/index.js"),
      dist(root, "mediaExport", "packages/media-export/dist/index.js"),
      dist(root, "igsExtract", "packages/igs/dist/scene/extract.js"),
    ]);
    const bdmvDir = resolveInput(root, o.bdmvDir);
    const parsed = await parser.parseBdmv(bdmvDir);
    // Menu button programs come from the IG packet dumps under STREAM (the
    // corpus stores demuxed IGS packets instead of full m2ts streams).
    const igDumps = (await walkFiles(join(bdmvDir, "STREAM"))).filter((file) => file.endsWith(".m2ts_ig-packets.bin"));
    const scenes = [];
    for (const dump of igDumps) {
      const clipId = basename(dump).slice(0, 5);
      const igBytes = new Uint8Array(await readFile(dump));
      async function* chunks() { for (let at = 0; at < igBytes.length; at += 4093) yield igBytes.subarray(at, Math.min(igBytes.length, at + 4093)); }
      const extracted = await igsExtract.extractIgsFromChunks(clipId, chunks(), [{ pid: 0x1400, source: { path: `BDMV/CLIPINF/${clipId}.clpi`, origin: "primary", offset: "0" } }], { captureStreams: false, renderAssets: false });
      scenes.push(...extracted.scenes);
    }
    // Button programs mirror apps/cli/src/shared/media.ts buildMediaClosure.
    const programs = scenes.flatMap((scene) => scene.pages.flatMap((page) => page.buttons.filter((button) => button.commands.length).map((button) => ({ scene, button }))));
    const buttonPrograms = programs.map(({ scene, button }, programId) => ({ id: 1_000_000 + programId, instructions: button.commands.map((command) => {
      const bytes = Buffer.from(command.bytes); const words = [bytes.readUInt32BE(0), bytes.readUInt32BE(4), bytes.readUInt32BE(8)];
      return { bytes: bytes.toString("hex"), words, source: { path: `BDMV/STREAM/${scene.clipId}.m2ts`, origin: "primary", offset: command.sourceOffset } };
    }) }));
    const buttonRoots = buttonPrograms.map((program, programId) => ({ nodeId: `object:${1_000_000 + programId}`, programId }));
    const describeValue = (result) => describe(result, { graphNodes: result.graph.nodes.length, graphEdges: result.graph.edges.length, playlists: result.closure.playlistIds.length, routes: result.closure.routes.length, unknown: result.closure.unknown.length }, { value: result.graph.edges.length, unit: "graph edges" });
    const run = () => {
      const graph = hdmv.buildNavigationGraph(parsed.movieObjects, buttonPrograms, { entries: parsed.entries });
      const closure = mediaExport.computeMediaClosure(parsed, graph, buttonRoots);
      return { graph, closure };
    };
    const navInput = { path: toPortablePath(root, o.bdmvDir), preParsed: true, buttonPrograms: buttonPrograms.length, movieObjects: parsed.movieObjects.length };
    return { run, validate: (v) => { const d = describeValue(v); expected(d.details, o.expected, caseDef.caseId); usefulOutput(d, caseDef.caseId); }, describe: describeValue, scope: caseDef.scope, input: navInput, fixture: caseDef.fixture };
  }
  if (caseDef.category === "graph") {
    const [parser, parserSteps] = await Promise.all([dist(root, "parser", "packages/bdmv-parser/dist/index.js"), dist(root, "parserSteps", "packages/bdmv-parser/dist/parsing/parser.js")]);
    const graphTree = o.files?.length ? await (await import("./fixture-input.mjs")).materializeBdmvFiles(caseDef.fixtureRoot, o.files) : null;
    const bdmvDir = graphTree?.directory ?? resolveInput(root, o.bdmvDir), parsed = await parser.parseBdmv(bdmvDir), paths = await walkFiles(bdmvDir);
    const files = await Promise.all(paths.map(async (path) => ({ rel: `BDMV/${relative(bdmvDir, path).replaceAll("\\", "/")}`, abs: path, size: (await stat(path)).size })));
    const run = () => parserSteps.buildGraph(parsed.entries, parsed.movieObjects, parsed.playlists, parsed.clips, parsed.sounds, files, []);
    const describeValue = (g) => describe(g, { nodes: g.nodes.length, edges: g.edges.length }, { value: g.nodes.length + g.edges.length, unit: "graph elements" });
    const graphInput = { fileCount: files.length, preParsed: true, ...(o.files ? { files: o.files.map((file) => ({ ...file, path: toPortablePath(root, file.path) })) } : { path: toPortablePath(root, o.bdmvDir) }) };
    return { run, validate: (v) => { const d = describeValue(v); expected(d.details, o.expected, caseDef.caseId); usefulOutput(d, caseDef.caseId); }, describe: describeValue, scope: caseDef.scope, input: graphInput, fixture: caseDef.fixture, ...(graphTree ? { afterMeasurement: graphTree.cleanup } : {}) };
  }
  if (caseDef.category === "mnu") {
    const { source, streamBytes, parse } = await parseMnu(root, o);
    const scene = parse(), before = JSON.stringify(describeMnu(scene));
    const describeValue = o.operation === "parse" ? describeMnu : (assets) => {
      let pngBytes = 0, pixels = 0; for (const a of assets.assets) { pngBytes += a.pngBytes.byteLength; pixels += a.width * a.height; }
      return describe(assets, { assets: assets.assets.length, pngBytes, pixels, errors: assets.diagnostics.filter((d) => d.severity === "error").length }, { value: pixels, unit: "rendered pixels" });
    };
    if (o.operation === "parse") return { run: parse, validate: (v) => { const d = describeMnu(v); expected(d.details, o.expected, caseDef.caseId); if (d.details.status !== "complete") throw new Error("MNU parse status is incomplete"); usefulOutput(d, caseDef.caseId); }, describe: describeMnu, scope: caseDef.scope, input: { path: toPortablePath(root, o.file), sourceBytes: source.length, mnuBytes: streamBytes.length }, fixture: caseDef.fixture };
    const igsPng = await dist(root, "igsPng", "packages/igs/dist/rendering/png.js");
    return { run: () => igsPng.renderIgsAssets(scene.scenes), validate: (v) => { const d = describeValue(v); expected(d.details, o.expectedRender, caseDef.caseId); if (d.details.errors) throw new Error("IGS rendering returned errors"); usefulOutput(d, caseDef.caseId); if (JSON.stringify(describeMnu(scene)) !== before) throw new Error(`${caseDef.caseId}: rendering modified pre-parsed scene state`); }, describe: describeValue, scope: caseDef.scope, input: { path: toPortablePath(root, o.file), mnuBytes: streamBytes.length, prepared: true }, fixture: caseDef.fixture };
  }
  if (caseDef.category === "pgs") {
    const [pgs, pgsRender] = await Promise.all([dist(root, "pgs", "packages/media-export/dist/pgs/pgs.js"), dist(root, "pgsRender", "packages/media-export/dist/pgs/pgs-render.js")]);
    const bytes = o.source === "synthetic" ? syntheticPgs(o) : new Uint8Array(await readFile(resolveInput(root, o.file)));
    const parsed = pgs.parsePgsSup(bytes);
    if (!parsed.length) throw new Error("PGS contains zero display sets");
    let index = 0; if (o.displaySet !== "largest" && Number.isInteger(o.displaySet)) index = o.displaySet - 1; else for (let i = 1; i < parsed.length; i++) if (countPixels(parsed[i]) > countPixels(parsed[index])) index = i;
    const run = o.operation === "parse" ? () => pgs.parsePgsSup(bytes) : () => pgsRender.renderPgsDisplaySet(parsed[index], index + 1, null);
    const describeValue = o.operation === "parse" ? describePgs : (r) => describe(r, { visible: r.visible, pngBytes: r.pngBytes.length, width: r.width, height: r.height }, { value: r.width * r.height, unit: "canvas pixels" });
    return { run, validate: (v) => { const description = describeValue(v), d = description.details; expected(d, o.operation === "compose" ? o.expectedCompose : o.expected, caseDef.caseId); usefulOutput(description, caseDef.caseId); if (o.operation === "compose" && !d.visible) throw new Error("PGS display set is not visible"); }, describe: describeValue, scope: caseDef.scope, input: { path: o.source === "synthetic" ? null : toPortablePath(root, o.file), sourceBytes: bytes.length, selectedDisplaySet: index + 1 }, fixture: caseDef.fixture };
  }
  if (caseDef.category === "package") {
    const { prepareIgsInput, assembleIgsMenuPackage } = await import("./graphics.mjs");
    const prepared = await prepareIgsInput(root, { ...o, fixtureId: caseDef.fixture.id });
    const outputRoot = await mkdtemp(join(tmpdir(), "bdmv2web-package-bench-"));
    let sequence = 0;
    const describeValue = (result) => describe(result, { ...prepared.expected, packageDiagnostics: result.diagnostics.length }, { value: prepared.expected.assets, unit: "packaged IGS assets" });
    return {
      run: async () => {
        const outputDirectory = join(outputRoot, `package-${sequence++}`);
        return assembleIgsMenuPackage(root, outputDirectory, prepared, o.packageOptions);
      },
      validate: (result) => { const d = describeValue(result); expected(d.details, o.expected, caseDef.caseId); usefulOutput(d, caseDef.caseId); },
      describe: describeValue, scope: caseDef.scope,
      input: prepared.input, fixture: caseDef.fixture,
      afterMeasurement: () => rm(outputRoot, { recursive: true, force: true }),
    };
  }
  throw new Error(`Unsupported benchmark case: ${caseDef.caseId}`);
}

function createWorkerCommand() {
  return createProgram("bench-worker", "Measure one benchmark case in an isolated process.")
    .requiredOption("--case <caseId>", "stable case ID")
    .requiredOption("--root <dir>", "code root")
    .option("--fixture-root <dir>", "fixture root")
    .option("--warmup-ms <ms>", "warmup duration in milliseconds", numberArgument, 100)
    .option("--time-ms <ms>", "measurement duration in milliseconds", numberArgument, 500)
    .option("--min-samples <count>", "minimum samples", integerArgument, 10)
    .option("--calls-per-sample <count>", "operation calls per timing sample; omit to calibrate", integerArgument);
}

async function main() {
  const options = parseOptions(createWorkerCommand(), process.argv.slice(2));
  const { case: caseId, root, warmupMs, timeMs, minSamples, callsPerSample: fixedCallsPerSample } = options;
  const fixtureRoot = options.fixtureRoot ?? root;
  const definitions = await getCaseDefinitions({ root, fixtureRoot });
  const def = definitions.find((x) => x.caseId === caseId);
  if (!def) throw new Error(`Unknown benchmark caseId: ${caseId}`);
  const prepared = await prepareCase(def, root);
  const sendResult = (result) => { if (process.send) process.send({ kind: "bench-result", result }, () => process.disconnect()); else process.stdout.write(JSON.stringify(result)); };
  if (prepared.skip) { sendResult({ caseId, skip: String(prepared.skip) }); return; }
  if (!(warmupMs >= 0 && timeMs > 0 && minSamples > 0)) throw new Error("Invalid worker time budget");
  const initial = prepared.run(), asyncOperation = Boolean(initial && typeof initial.then === "function");
  const validationValue = await initial; await prepared.validate?.(validationValue);
  const callsPerSample = fixedCallsPerSample ?? await calibrateCallsPerSample(() => prepared.run(), { warmupMs });
  if (!(callsPerSample >= 1)) throw new Error(`Invalid calls per sample: ${callsPerSample}`);
  const runSample = asyncOperation
    ? async () => { let value; for (let index = 0; index < callsPerSample; index += 1) value = await prepared.run(); return value; }
    : () => { let value; for (let index = 0; index < callsPerSample; index += 1) value = prepared.run(); return value; };
  const memorySamples = [], gc = observeGc();
  // A synchronous benchmark blocks the event loop, so an interval timer never fires
  // and the record kept only the first and last snapshot. Sampled iterations run
  // outside the timed window and give the peak columns a real series. Sampling every
  // iteration matters most for slow cases: a 30 ms operation only fits a dozen
  // iterations into the window, so skipping seven of every eight left four points.
  const sampleMemory = () => {
    if (memorySamples.length >= 256) return;
    memorySamples.push(process.memoryUsage());
  };
  const cpuStart = process.cpuUsage(), wallStart = process.hrtime.bigint();
  memorySamples.push(process.memoryUsage());
  const timer = setInterval(() => memorySamples.push(process.memoryUsage()), 50);
  let last = validationValue;
  const bench = new Bench({ time: timeMs, iterations: minSamples, warmup: true, warmupTime: warmupMs, warmupIterations: 1, retainSamples: true, throws: true });
  bench.add(caseId, () => { last = runSample(); return last; }, { async: asyncOperation, beforeEach: sampleMemory });
  let cpuUsage, wallMs;
  try {
    await bench.run();
    cpuUsage = process.cpuUsage(cpuStart); wallMs = Number(process.hrtime.bigint() - wallStart) / 1e6;
  } finally {
    clearInterval(timer); memorySamples.push(process.memoryUsage());
    await gc.stop();
    await prepared.afterMeasurement?.();
  }
  const task = bench.tasks[0];
  // `throws: true` keeps the bench running after an operation throws, and the
  // failed call still contributes a latency sample. An errored task has no
  // usable distribution, so the fork fails instead of reporting it.
  if (task?.result?.state === "errored") throw new Error(`${caseId} threw during measurement: ${task.result.error.message}`, { cause: task.result.error });
  if (last && typeof last.then === "function") last = await last;
  await prepared.validate?.(last);
  const samples = [...(task?.result?.latency?.samples ?? [])];
  if (samples.length < minSamples) throw new Error(`Tinybench recorded ${samples.length} samples; required ${minSamples}`);
  const rawMsPerCall = callsPerSample === 1 ? samples : samples.map((sample) => sample / callsPerSample);
  const peak = (read) => Math.max(...memorySamples.map(read));
  const result = {
    caseId, scope: prepared.scope, input: prepared.input, fixture: prepared.fixture, output: prepared.describe(last),
    callsPerSample, iterations: samples.length, rawMsPerCall,
    // `process.cpuUsage` only sees this process. Cases that spawn a CLI child
    // report that scope explicitly instead of implying the number covers the work.
    cpuUsage: { ...cpuUsage, unit: "microseconds", coversSpawnedProcess: def.spawnsChild !== true,
      scope: def.spawnsChild === true ? "parent process CPU time only: the measured work runs in a spawned CLI process" : "process CPU time over the Tinybench warmup and measured interval" },
    wallMs,
    runtime: { execArgv: process.execArgv, nodeOptions: process.env.NODE_OPTIONS ?? null },
    memory: {
      maxRSSBytes: normalizeMaxRssBytes(process.resourceUsage().maxRSS), peakObservedRssBytes: peak((sample) => sample.rss),
      heapUsedBytes: peak((sample) => sample.heapUsed), externalBytes: peak((sample) => sample.external), arrayBuffersBytes: peak((sample) => sample.arrayBuffers),
      sampleCount: memorySamples.length,
      samples: memorySamples.map((sample) => ({ rss: sample.rss, heapUsed: sample.heapUsed, external: sample.external, arrayBuffers: sample.arrayBuffers })),
      scope: "process memory sampled at every iteration plus a 50 ms timer for async cases, with a start and end snapshot, capped at 256 points; maxRSSBytes is the process-lifetime peak",
    },
    gc: { available: gc.available, unavailableReason: gc.reason ?? null, events: gc.events, scope: "GC events during the Tinybench warmup and measured interval" },
  };
  sendResult(result);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => exitWithError(error, 1, { stack: true }));
