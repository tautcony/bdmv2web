import { execFileSync } from "node:child_process";
import { readFile, rm, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { toPortablePath } from "./fixture-input.mjs";

const SCALES = [1, 2, 4];
const GRAPH_CASE = "perf.graph.tamako.build";
const IGS_PACKET_CASE = "perf.igs.battle-royale.parse";
const IGS_RENDER_CASE = "perf.igs.battle-royale.render";
const SCALE_NAMES = { "graph-build": "Navigation graph build", "rle-decode": "RLE decode", "png-encode-with-crc": "PNG encode", "pes-transport-and-igs-extract": "PES transport and IGS extract" };

function definition(caseId, category, sample, scope, parameters, options = {}) {
  return {
    caseId, suite: "scenario", category, name: `${SCALE_NAMES[scope] ?? category} · ${parameters.scale}×`, sample,
    fixture: { id: sample, version: "1", parameters }, scope,
    options: { ...parameters, ...options },
  };
}

export async function getScenarioDefinitions({ root, fixtureRoot = root, manifestCases = [] } = {}) {
  const perfFile = (path) => path.startsWith("test-data/fixtures/perf/")
    ? resolve(fixtureRoot, path)
    : resolve(fixtureRoot, "test-data/fixtures/perf", path);
  const byId = new Map(manifestCases.map((item) => [item.caseId, item]));
  const graphCase = byId.get(GRAPH_CASE);
  const igsPacketCase = byId.get(IGS_PACKET_CASE);
  const igsRenderCase = byId.get(IGS_RENDER_CASE);
  const packetPath = (item) => item.source?.packetPath ?? item.input.path.replace(/\.mnu$/, ".bin");
  const result = [];
  for (const scale of SCALES) {
    if (graphCase) result.push({
      ...definition(`scale.graph-${scale}x.build`, "scale", `metadata-graph-${scale}x`, "graph-build", { scale, objectCopies: scale }),
      fixtureRoot, options: { scale, objectCopies: scale, files: graphCase.options.files },
    });
    result.push(definition(`scale.rle-${scale}x.decode`, "scale", `synthetic-rle-${scale}x`, "rle-decode", { scale, width: 256 * scale, height: 128 * scale, pixels: 256 * 128 * scale * scale }));
    result.push(definition(`scale.png-${scale}x.encode`, "scale", `synthetic-png-${scale}x`, "png-encode-with-crc", { scale, width: 128 * scale, height: 72 * scale, pixels: 128 * 72 * scale * scale }));
    if (igsPacketCase) result.push(definition(`scale.pes-${scale}x.extract`, "scale", `igs-transport-${scale}x`, "pes-transport-and-igs-extract", { scale, packetSize: 192, clipId: igsPacketCase.options.clipId, pid: igsPacketCase.options.pid }, { file: perfFile(packetPath(igsPacketCase)) }));
  }
  if (graphCase) {
    const files = (graphCase.options.files ?? []).map((file) => ({ path: file.path, virtualPath: file.virtualPath }));
    for (const [operation, scope, name] of [
      ["inspect", "cli-metadata-inspect", "CLI inspect metadata-only BDMV"],
      ["extract", "cli-hdmv-extract", "CLI HDMV extraction from metadata-only BDMV"],
    ]) {
      result.push({
        caseId: `cli.perf.metadata.${operation}`, suite: "scenario", category: "cli", name, sample: graphCase.sample,
        fixture: graphCase.fixture, fixtureRoot, scope, spawnsChild: true, options: { operation, files },
      });
    }
  }
  result.push({
    caseId: "cli.startup.version", suite: "scenario", category: "cli", name: "CLI process start and version",
    sample: "cli-runtime", fixture: { id: "cli-runtime", version: "1", parameters: {} },
    scope: "cli-startup", spawnsChild: true, options: { operation: "version" },
  });
  if (igsRenderCase) {
    result.push({
      caseId: "cli.perf.igs.render", suite: "scenario", category: "cli", name: "CLI MNU PNG render", sample: igsRenderCase.sample,
      fixture: igsRenderCase.fixture, fixtureRoot, scope: "cli-mnu-png-render", spawnsChild: true, options: { operation: "render", input: igsRenderCase.options.file },
    });
  }
  const browserFixture = { id: "synthetic-browser-menu", version: "1", parameters: { packageBuilder: "buildMenuPackage", buttonCount: 2, navigation: "Start menu preview, then ArrowRight and Enter" } };
  result.push({
    caseId: "cli.synthetic-package.validate", suite: "scenario", category: "cli", name: "CLI synthetic package audit", sample: "synthetic-browser-menu",
    fixture: browserFixture, scope: "cli-package-audit", spawnsChild: true, options: { operation: "validate", packageBuilder: "buildMenuPackage" },
  });
  if (igsPacketCase) {
    const expected = igsPacketCase.expected?.details ?? {};
    const packageInput = {
      source: "ig-packets", file: perfFile(packetPath(igsPacketCase)),
      clipId: igsPacketCase.options.clipId, pid: igsPacketCase.options.pid, chunkBytes: igsPacketCase.options.chunkBytes ?? 256 * 1024,
      expected: Object.fromEntries(["scenes", "pages", "objects", "palettes", "assets"].filter((key) => expected[key] !== undefined).map((key) => [key, expected[key]])),
    };
    // The two rows split the same prepared input: scripts only, then scripts plus the
    // filesystem writes, so a disk difference shows up in one row instead of both.
    result.push({
      caseId: "perf.package.igs-serialize", suite: "scenario", category: "package", name: "Package scripts from complete IGS scene", sample: igsPacketCase.sample,
      fixture: { ...igsPacketCase.fixture, parameters: { ...igsPacketCase.fixture.parameters, operation: "package-serialize" } }, fixtureRoot,
      scope: "igs-package-serialize", options: packageInput,
    });
    result.push({
      caseId: "perf.package.igs-assembly", suite: "scenario", category: "package", name: "Package assembly from complete IGS scene", sample: igsPacketCase.sample,
      fixture: { ...igsPacketCase.fixture, parameters: { ...igsPacketCase.fixture.parameters, operation: "package-assembly" } }, fixtureRoot,
      scope: "igs-package-assembly", options: packageInput,
    });
  }
  result.push({
    caseId: "browser.synthetic-menu.file-navigation",
    suite: "scenario", category: "browser", name: "Browser file URL menu navigation", sample: "synthetic-browser-menu",
    fixture: browserFixture,
    scope: "package-build-plus-file-url-browser-navigation",
    options: { operation: "file-navigation" },
  });
  return result;
}

const fileFor = (root, rel) => resolve(root, rel);
const readModule = async (root, rel) => import(pathToFileURL(fileFor(root, rel)).href);

function rleFixture(scale) {
  const width = 256 * scale;
  const height = 128 * scale;
  const bytes = [];
  for (let y = 0; y < height; y++) {
    let remaining = width;
    while (remaining > 0) {
      const run = Math.min(63, remaining);
      bytes.push(0, 0x80 | run, y & 0xff);
      remaining -= run;
    }
    bytes.push(0, 0);
  }
  return { width, height, bytes: Uint8Array.from(bytes) };
}

function graphInput(parsed, scale) {
  const objects = [];
  for (let copy = 0; copy < scale; copy++) {
    for (const object of parsed.movieObjects) objects.push({ ...object, id: object.id + copy * 10_000 });
  }
  return { entries: parsed.entries, objects, playlists: parsed.playlists, clips: parsed.clips, sounds: parsed.sounds ?? [] };
}

async function* packetChunks(bytes, chunkSize = 188 * 47) {
  for (let offset = 0; offset < bytes.length; offset += chunkSize) yield bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
}

async function outputFileCount(directory) {
  let count = 0;
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    count += item.isDirectory() ? await outputFileCount(path) : item.isFile() ? 1 : 0;
  }
  return count;
}

async function runCli(root, caseDef, outputDir, sequence) {
  const cli = fileFor(root, "apps/cli/dist/index.js");
  const input = caseDef.options.operation === "validate" ? caseDef.options.packagePath
    : caseDef.options.operation === "version" ? undefined
      : fileFor(root, caseDef.options.input);
  const output = join(outputDir, `output-${sequence}-${caseDef.options.operation}`);
  let args;
  if (caseDef.options.operation === "version") args = ["--version"];
  else if (caseDef.options.operation === "inspect") args = ["inspect", input, "--allow-partial", "--format", "json"];
  else if (caseDef.options.operation === "extract") args = ["extract", input, "--type", "hdmv", "--out", output];
  else if (caseDef.options.operation === "render") args = ["render", input, "--out", output];
  else if (caseDef.options.operation === "validate") args = ["validate", input, "--format", "json"];
  else throw new Error(`Unsupported prepared CLI operation: ${caseDef.options.operation}`);
  let stdout;
  try { stdout = execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }); }
  catch (error) {
    const stderr = error?.stderr?.toString?.().trim() ?? "";
    throw new Error(`CLI ${args[0]} failed with exit ${error?.status ?? "unknown"}${stderr ? `: ${stderr}` : ""}`, { cause: error });
  }
  const report = args[0] === "inspect" || args[0] === "validate" ? JSON.parse(stdout) : null;
  // `--version` exits before any command module loads, so it measures the
  // process start and argument parsing that every CLI case also pays for.
  if (args[0] === "--version") return { command: "version", stdoutBytes: Buffer.byteLength(stdout.trim()), output: null };
  if (args[0] === "inspect" && !["complete", "partial"].includes(report.stageStatus)) throw new Error(`CLI inspect stageStatus is ${String(report.stageStatus)}`);
  if (args[0] === "extract" || args[0] === "render") {
    const stageReportPath = args[0] === "extract" ? join(output, "manifest.json") : join(output, "assets-manifest.json");
    const stageReport = JSON.parse(await readFile(stageReportPath, "utf8"));
    if (stageReport.stageStatus === "failed" || stageReport.status === "failed") throw new Error(`CLI ${args[0]} stage status is failed`);
  }
  if (args[0] === "validate" && report.checks?.some((check) => check.result === "fail")) throw new Error("CLI validate reported failed package checks");
  if (!report) {
    const destination = args[args.indexOf("--out") + 1];
    const fileCount = await outputFileCount(destination);
    if (!fileCount) throw new Error(`${args[0]} CLI completed without creating output files`);
  }
  return { command: args[0], stdoutBytes: Buffer.byteLength(stdout), output, ...(args[0] === "validate" ? { checks: report.checks?.length ?? 0, decision: report.decision?.status ?? null } : {}) };
}

export async function prepareScenarioCase(caseDef, root) {
  const { category, options, fixture } = caseDef;
  if (category === "scale" && caseDef.scope === "rle-decode") {
    const { decodeRle } = await readModule(root, "packages/igs/dist/igs.js");
    const input = rleFixture(options.scale);
    return { input: { bytes: input.bytes.byteLength, width: input.width, height: input.height }, fixture, scope: caseDef.scope,
      run: () => decodeRle(input.bytes, input.width, input.height),
      validate: (value) => { if (value.byteLength !== input.width * input.height) throw new Error("RLE output dimensions differ from fixture"); return { bytes: value.byteLength }; },
      describe: (value) => ({ summary: `Decoded ${value.byteLength} indexed pixels`, details: { bytes: value.byteLength, width: input.width, height: input.height }, units: { value: value.byteLength, unit: "pixels" } }) };
  }
  if (category === "scale" && caseDef.scope === "png-encode-with-crc") {
    const { encodeRgbaPng } = await readModule(root, "packages/igs/dist/png.js");
    const width = options.width; const height = options.height;
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < rgba.length; i += 4) { rgba[i] = i & 0xff; rgba[i + 1] = (i >>> 2) & 0xff; rgba[i + 2] = 96; rgba[i + 3] = 255; }
    return { input: { width, height, rgbaBytes: rgba.byteLength }, fixture, scope: caseDef.scope,
      run: () => encodeRgbaPng(width, height, rgba),
      validate: (png) => { if (png[0] !== 137 || png[1] !== 80 || png[2] !== 78 || png[3] !== 71) throw new Error("PNG signature is invalid"); return { pngBytes: png.byteLength }; },
      describe: (png) => ({ summary: `Encoded ${width}×${height} PNG`, details: { width, height, pngBytes: png.byteLength }, units: { value: width * height, unit: "pixels" } }) };
  }
  if (category === "scale" && caseDef.scope === "graph-build") {
    const { parseBdmv } = await readModule(root, "packages/bdmv-parser/dist/index.js");
    const { buildGraph } = await readModule(root, "packages/bdmv-parser/dist/parser.js");
    const { materializeBdmvFiles } = await import("./fixture-input.mjs");
    const materialized = await materializeBdmvFiles(caseDef.fixtureRoot ?? root, options.files);
    const parsed = await parseBdmv(materialized.directory);
    const data = graphInput(parsed, options.scale);
    const instructionCount = data.objects.reduce((sum, item) => sum + item.instructions.length, 0);
    return { input: { objects: data.objects.length, instructions: instructionCount, fixtureFileCount: options.files.length }, fixture: { ...fixture, parameters: { ...fixture.parameters, objectCount: data.objects.length, instructionCount } }, scope: caseDef.scope,
      run: () => buildGraph(data.entries, data.objects, data.playlists, data.clips, data.sounds, [], []),
      validate: (graph) => { if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error("Graph output is invalid"); return { nodes: graph.nodes.length, edges: graph.edges.length }; },
      describe: (graph) => ({ summary: `Built graph with ${graph.nodes.length} nodes and ${graph.edges.length} edges`, details: { nodes: graph.nodes.length, edges: graph.edges.length, objectCopies: options.scale } }),
      afterMeasurement: materialized.cleanup, cleanup: materialized.cleanup };
  }
  if (category === "scale" && caseDef.scope === "pes-transport-and-igs-extract") {
    const { extractIgsFromChunks } = await readModule(root, "packages/igs/dist/extract.js");
    const bytes = new Uint8Array(await readFile(fileFor(root, options.file)));
    const repeated = new Uint8Array(bytes.length * options.scale);
    for (let i = 0; i < options.scale; i++) repeated.set(bytes, i * bytes.length);
    const run = () => extractIgsFromChunks(options.clipId, packetChunks(repeated, 192 * 47), [{ pid: options.pid, source: { path: options.file, origin: "primary", offset: "0" } }], { chunkSize: 192 * 47, renderAssets: false });
    const packetCount = repeated.byteLength / options.packetSize;
    const sample = await run();
    if (!sample.scenes.length) throw new Error(`PES fixture yielded no IGS scenes at ${packetCount} packets`);
    return { input: { transportBytes: repeated.byteLength, packets: packetCount, scenes: sample.scenes.length, scale: options.scale }, fixture: { ...fixture, parameters: { ...fixture.parameters, packets: packetCount } }, scope: caseDef.scope,
      run,
      validate: (value) => { if (!Array.isArray(value.scenes)) throw new Error("IGS extraction returned no scenes collection"); return { scenes: value.scenes.length, diagnostics: value.diagnostics.length }; },
      describe: (value) => ({ summary: `Extracted ${value.scenes.length} scenes from ${packetCount} transport packets`, details: { transportBytes: repeated.byteLength, packets: packetCount, scenes: value.scenes.length, diagnostics: value.diagnostics.length } }) };
  }
  if (category === "cli") {
    const temp = await mkdtemp(join(tmpdir(), "bdmv2web-bench-cli-"));
    let sequence = 0;
    let packagePath;
    if (options.operation === "validate") {
      packagePath = join(temp, "synthetic-menu-package");
      const { buildSyntheticPackage } = await import("./browser.mjs");
      await buildSyntheticPackage(root, packagePath);
    }
    let materialized;
    let inputPath = options.input;
    if (options.files) {
      const { materializeBdmvFiles } = await import("./fixture-input.mjs");
      materialized = await materializeBdmvFiles(caseDef.fixtureRoot ?? root, options.files);
      inputPath = materialized.directory;
    }
    const cliCase = { ...caseDef, options: { ...options, input: inputPath, packagePath } };
    const run = () => runCli(root, cliCase, temp, sequence++);
    const validate = (value) => { if (value.command !== options.operation) throw new Error(`CLI ran ${value.command} instead of ${options.operation}`); return { command: value.command, stdoutBytes: value.stdoutBytes }; };
    const describe = (value) => ({ summary: `${value.command} CLI completed`, details: { command: value.command, stdoutBytes: value.stdoutBytes, ...(value.checks === undefined ? {} : { checks: value.checks, decision: value.decision }) } });
    const cleanup = async () => { await materialized?.cleanup(); await rm(temp, { recursive: true, force: true }); };
    const fixturePath = toPortablePath(root, inputPath);
    const input = { command: options.operation, ...(options.files ? { metadataFileCount: options.files.length } : {}), ...(fixturePath ? { fixturePath } : {}), ...(options.operation === "validate" ? { packageBuilder: "buildMenuPackage" } : {}) };
    return { input, fixture, scope: caseDef.scope, run, validate, describe, afterMeasurement: cleanup, cleanup };
  }
  if (category === "browser") {
    const { prepareBrowserScenario } = await import("./browser.mjs");
    try { return await prepareBrowserScenario(caseDef, root); }
    catch (error) { if (error?.code === "BENCH_SKIP") return { skip: error.message }; throw error; }
  }
  if (category === "package" && (caseDef.scope === "igs-package-assembly" || caseDef.scope === "igs-package-serialize")) {
    const { prepareIgsInput, assembleIgsMenuPackage, serializeIgsMenuPackage } = await import("./graphics.mjs");
    const prepared = await prepareIgsInput(root, options);
    for (const [key, value] of Object.entries(options.expected ?? {})) {
      if (prepared.expected[key] !== value) throw new Error(`IGS package fixture ${key}=${prepared.expected[key]}, expected ${value}`);
    }
    if (caseDef.scope === "igs-package-serialize") {
      const run = () => serializeIgsMenuPackage(root, prepared);
      const validate = (value) => {
        if (!Number.isSafeInteger(value.assets) || value.assets !== prepared.graphics.length) throw new Error(`Package scripts covered ${value.assets} of ${prepared.graphics.length} IGS assets`);
        return { batches: value.batches, assets: value.assets, scriptBytes: value.bytes };
      };
      return {
        input: { ...prepared.input, ...prepared.expected }, fixture: caseDef.fixture, scope: caseDef.scope, run, validate,
        describe: (value) => ({ summary: `Serialized ${value.batches} asset batches and the package scripts for ${value.assets} IGS PNG assets`, details: { ...prepared.expected, batches: value.batches, scriptBytes: value.bytes } }),
      };
    }
    const temp = await mkdtemp(join(tmpdir(), "bdmv2web-bench-package-"));
    let sequence = 0;
    const run = async () => {
      const outputDirectory = join(temp, `package-${sequence++}`);
      const result = await assembleIgsMenuPackage(root, outputDirectory, prepared);
      return { outputDirectory, diagnostics: result.diagnostics.length };
    };
    const validate = (value) => {
      if (!Number.isSafeInteger(value.diagnostics) || value.diagnostics < 0) throw new Error("Package assembly returned an invalid diagnostic count");
      return { packageDiagnostics: value.diagnostics, graphicsAssets: prepared.graphics.length };
    };
    return {
      input: { ...prepared.input, ...prepared.expected }, fixture: caseDef.fixture, scope: caseDef.scope, run, validate,
      describe: (value) => ({ summary: `Assembled a menu package with ${prepared.graphics.length} IGS PNG assets`, details: { ...prepared.expected, packageDiagnostics: value.diagnostics } }),
      afterMeasurement: () => rm(temp, { recursive: true, force: true }), cleanup: () => rm(temp, { recursive: true, force: true }),
    };
  }
  throw new Error(`Unknown performance scenario: ${caseDef.caseId}`);
}
