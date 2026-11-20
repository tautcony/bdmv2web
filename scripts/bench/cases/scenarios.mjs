import { execFileSync } from "node:child_process";
import { cp, readFile, rm, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { toPortablePath } from "./fixture-input.mjs";
import { assertScanInput, growWithNullPackets, growWithRepeatedPackets } from "./clip-growth.mjs";

function transportStats(bytes) {
  let packets = 0, nullPackets = 0;
  for (let offset = 0; offset + 192 <= bytes.length; offset += 192) {
    packets++;
    if ((((bytes[offset + 5] & 0x1f) << 8) | bytes[offset + 6]) === 0x1fff) nullPackets++;
  }
  return { packets, nullPackets, nullPacketShare: packets ? nullPackets / packets : 0 };
}
function sumTransport(left, right) {
  return {
    packets: left.packets + right.packets,
    nullPackets: left.nullPackets + right.nullPackets,
    nullPacketShare: (left.nullPackets + right.nullPackets) / Math.max(1, left.packets + right.packets),
  };
}

const SCALES = [1, 2, 4];
const GRAPH_CASE = "perf.graph.tamako.build";
const IGS_PACKET_CASE = "perf.igs.battle-royale.parse";
const IGS_RENDER_CASE = "perf.igs.battle-royale.render";
// The synthetic disc carries two clips that declare PGS (0x90) and IGS (0x91)
// in one PMT, so it feeds both graphics readers from a single clip.
const SYNTHETIC_DISC = "test-data/fixtures/synthetic-all-features/BDMV";
const SYNTHETIC_CLIPS = ["00001", "00002"];
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
      ["export", "cli-metadata-export", "CLI metadata export from metadata-only BDMV"],
    ]) {
      result.push({
        caseId: `cli.perf.metadata.${operation}`, suite: "scenario", category: "cli", name, sample: graphCase.sample,
        fixture: graphCase.fixture, fixtureRoot, scope, spawnsChild: true, baselineCaseId: `cli.floor.${operation}`, options: { operation, files },
      });
    }
  }
  result.push({
    caseId: "cli.startup.version", suite: "scenario", category: "cli", name: "CLI process start and version",
    sample: "cli-runtime", fixture: { id: "cli-runtime", version: "1", parameters: {} },
    scope: "cli-startup", spawnsChild: true, options: { operation: "version" },
  });
  // A CLI row pays process start, argument parsing, the command's module graph, and
  // its input check before any measured work. A floor row runs the same command
  // against a path that does not exist, so a reader can subtract what the command
  // costs to load instead of counting it as work. `cli.startup.version` measures the
  // process and the program only: it exits before any command module loads.
  for (const command of ["inspect", "list", "export", "render", "validate"]) {
    result.push({
      caseId: `cli.floor.${command}`, suite: "scenario", category: "cli", name: `CLI ${command} load floor (missing input)`,
      sample: "cli-runtime", fixture: { id: "cli-runtime", version: "1", parameters: { command, input: "missing" } },
      scope: "cli-load-floor", spawnsChild: true, floorRow: true, options: { operation: "floor", command },
    });
  }
  if (igsRenderCase) {
    result.push({
      caseId: "cli.perf.igs.render", suite: "scenario", category: "cli", name: "CLI MNU PNG render", sample: igsRenderCase.sample,
      fixture: igsRenderCase.fixture, fixtureRoot, scope: "cli-mnu-png-render", spawnsChild: true, baselineCaseId: "cli.floor.render", options: { operation: "render", input: igsRenderCase.options.file },
    });
  }
  // Repeat the committed clips to measure packet scanning and graphics extraction
  // at larger input sizes. Repetition keeps every PID continuous and can produce
  // more timed display sets and button programs from the same graphics content.
  const CLIP_BYTES = 8 * 1024 * 1024;
  const STREAM_BYTES = 16 * 1024 * 1024;
  result.push({
    caseId: "cli.perf.list.table", suite: "scenario", category: "cli", name: "CLI list table over 16 MiB of clip data", sample: "synthetic-clip-set",
    fixture: { id: "synthetic-clip-set", version: "2", parameters: { disc: "synthetic-all-features", clips: SYNTHETIC_CLIPS.join(","), clipBytes: CLIP_BYTES, fill: "repeated-packets" } },
    fixtureRoot, scope: "cli-list-table", spawnsChild: true, baselineCaseId: "cli.floor.list",
    options: { operation: "list", input: SYNTHETIC_DISC, clips: SYNTHETIC_CLIPS, clipBytes: CLIP_BYTES },
  });
  result.push({
    caseId: "cli.perf.stream.export", suite: "scenario", category: "cli", name: "CLI stream export over a 16 MiB IGS and PGS clip", sample: "synthetic-clip-set",
    fixture: { id: "synthetic-clip-set", version: "2", parameters: { clip: "00002", pids: "0x1400,0x1200,0x1201", clipBytes: STREAM_BYTES, fill: "repeated-packets" } },
    fixtureRoot, scope: "cli-stream-export", spawnsChild: true, baselineCaseId: "cli.floor.export",
    options: { operation: "stream-export", input: `${SYNTHETIC_DISC}/STREAM/00002.m2ts`, clipBytes: STREAM_BYTES },
  });
  // Disc export replays retained PGS packets from complete IGS scans when available.
  // The filtered row narrows this work to the one clip selected by --m2ts.
  for (const [suffix, m2ts] of [["", null], ["filtered", "00001"]]) {
    result.push({
      caseId: `cli.perf.bdmv.export${suffix ? `.${suffix}` : ""}`, suite: "scenario", category: "cli",
      name: `CLI BDMV export${m2ts ? ` limited to clip ${m2ts}` : ""} over 16 MiB of clip data`, sample: "synthetic-clip-set",
      fixture: { id: "synthetic-clip-set", version: "2", parameters: { disc: "synthetic-all-features", clips: SYNTHETIC_CLIPS.join(","), clipBytes: CLIP_BYTES, fill: "repeated-packets", ...(m2ts ? { m2ts } : {}) } },
      fixtureRoot, scope: "cli-bdmv-export", spawnsChild: true, baselineCaseId: "cli.floor.export",
      options: { operation: "bdmv-export", input: SYNTHETIC_DISC, clips: SYNTHETIC_CLIPS, clipBytes: CLIP_BYTES, ...(m2ts ? { m2ts } : {}) },
    });
  }
  // `--type sup` still runs the IGS extraction that discovers which SUP tracks are
  // reachable, while `--type igs` writes the containers and stops; the pair
  // separates that IGS read from the PGS read itself on the same input.
  for (const type of ["igs", "sup"]) {
    result.push({
      caseId: `cli.perf.bdmv.export.${type}`, suite: "scenario", category: "cli", name: `CLI BDMV export --type ${type} over 16 MiB of clip data`, sample: "synthetic-clip-set",
      fixture: { id: "synthetic-clip-set", version: "2", parameters: { disc: "synthetic-all-features", clips: SYNTHETIC_CLIPS.join(","), clipBytes: CLIP_BYTES, fill: "repeated-packets", type } },
      fixtureRoot, scope: "cli-bdmv-export", spawnsChild: true, baselineCaseId: "cli.floor.export",
      options: { operation: "bdmv-export", input: SYNTHETIC_DISC, clips: SYNTHETIC_CLIPS, clipBytes: CLIP_BYTES, type },
    });
  }
  // These rows exist to state the ceiling: the same commands over an input that is
  // pure stuffing, so every packet is skipped. They say what a command costs when
  // there is nothing to read; they are not a description of a clip.
  result.push({
    caseId: "cli.io.list.null-clip", suite: "scenario", category: "cli", name: "CLI list table over 64 MiB of null packets (I/O ceiling)", sample: "synthetic-clip-set",
    fixture: { id: "synthetic-clip-set", version: "2", parameters: { disc: "synthetic-all-features", clips: SYNTHETIC_CLIPS.join(","), clipBytes: 32 * 1024 * 1024, fill: "null-packets" } },
    fixtureRoot, scope: "cli-io-ceiling", spawnsChild: true, baselineCaseId: "cli.floor.list", ioCeiling: true,
    options: { operation: "list", input: SYNTHETIC_DISC, clips: SYNTHETIC_CLIPS, clipBytes: 32 * 1024 * 1024, fill: "null" },
  });
  result.push({
    caseId: "cli.io.bdmv.export.null-clip", suite: "scenario", category: "cli", name: "CLI BDMV export over 64 MiB of null packets (I/O ceiling)", sample: "synthetic-clip-set",
    fixture: { id: "synthetic-clip-set", version: "2", parameters: { disc: "synthetic-all-features", clips: SYNTHETIC_CLIPS.join(","), clipBytes: 32 * 1024 * 1024, fill: "null-packets" } },
    fixtureRoot, scope: "cli-io-ceiling", spawnsChild: true, baselineCaseId: "cli.floor.export", ioCeiling: true,
    options: { operation: "bdmv-export", input: SYNTHETIC_DISC, clips: SYNTHETIC_CLIPS, clipBytes: 32 * 1024 * 1024, fill: "null" },
  });
  // The CLI extracts a SUP track by writing a temporary file, reading it back, and
  // reparsing it to count display sets. This row runs that whole path in process, so
  // a change in the write-read-reparse loop shows up without a disc around it.
  result.push({
    caseId: "perf.pgs.disc-extract", suite: "scenario", category: "pgs", name: "SUP track extraction from a 2 MiB clip", sample: "synthetic-clip-set",
    fixture: { id: "synthetic-clip-set", version: "2", parameters: { clip: "00002", pids: "0x1200,0x1201", clipBytes: 2 * 1024 * 1024, fill: "repeated-packets" } },
    fixtureRoot, scope: "pgs-track-extract",
    options: { input: `${SYNTHETIC_DISC}/STREAM/00002.m2ts`, clipBytes: 2 * 1024 * 1024, pids: [0x1200, 0x1201] },
  });
  const browserFixture = { id: "synthetic-browser-menu", version: "1", parameters: { packageBuilder: "assembleMenuPackage", buttonCount: 2, navigation: "Start menu preview, then ArrowRight and Enter" } };
  result.push({
    caseId: "cli.synthetic-package.validate", suite: "scenario", category: "cli", name: "CLI synthetic package audit", sample: "synthetic-browser-menu",
    fixture: browserFixture, scope: "cli-package-audit", spawnsChild: true, baselineCaseId: "cli.floor.validate", options: { operation: "validate", packageBuilder: "assembleMenuPackage" },
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

const GROW = { repeated: growWithRepeatedPackets, null: growWithNullPackets };

/** Copy the committed disc and grow its clips, so a scan case reads megabytes rather than a few packets. */
async function grownDisc(fixtureRoot, sourcePath, directory, clips, clipBytes, fill) {
  const grow = GROW[fill];
  const target = join(directory, "BDMV");
  await cp(fileFor(fixtureRoot, sourcePath), target, { recursive: true });
  let transport = { packets: 0, nullPackets: 0, nullPacketShare: 0 };
  for (const clip of clips) {
    const path = join(target, "STREAM", `${clip}.m2ts`);
    const grown = grow(new Uint8Array(await readFile(path)), clipBytes);
    await writeFile(path, grown);
    transport = sumTransport(transport, transportStats(grown));
  }
  return { directory: target, transport };
}

/** Copy one committed clip and grow it in place of the original. */
async function grownClip(fixtureRoot, sourcePath, directory, clipBytes, fill) {
  const source = fileFor(fixtureRoot, sourcePath);
  const target = join(directory, basename(source));
  const grown = GROW[fill](new Uint8Array(await readFile(source)), clipBytes);
  await writeFile(target, grown);
  return { file: target, transport: transportStats(grown) };
}

async function runCli(root, caseDef, outputDir, sequence, observeChild = false) {
  const cli = fileFor(root, "apps/cli/dist/index.js");
  // A floor case aims at a path that cannot exist: the command still loads its
  // module graph and validates the input, then exits non-zero.
  const missingPath = caseDef.options.operation === "floor" ? join(outputDir, `missing-input-${caseDef.options.command}-${sequence}`) : null;
  const input = missingPath ?? (caseDef.options.operation === "validate" ? caseDef.options.packagePath
    : caseDef.options.operation === "version" ? undefined
      : fileFor(root, caseDef.options.input));
  const output = join(outputDir, `output-${sequence}-${caseDef.options.operation}`);
  let args;
  if (caseDef.options.operation === "floor") {
    const command = caseDef.options.command;
    // `export` and `render` reject a run without an output directory before they
    // read the input, so the floor row has to pass one to reach the same check.
    args = ["export", "render"].includes(command) ? [command, missingPath, "--out", join(outputDir, `floor-output-${sequence}`)] : [command, missingPath];
  }
  else if (caseDef.options.operation === "version") args = ["--version"];
  else if (caseDef.options.operation === "inspect") args = ["inspect", input, "--allow-partial", "--format", "json"];
  else if (caseDef.options.operation === "export") args = ["export", input, "--type", "hdmv", "--out", output];
  else if (caseDef.options.operation === "list") args = ["list", input];
  else if (caseDef.options.operation === "stream-export") args = ["export", input, "--out", output];
  else if (caseDef.options.operation === "bdmv-export") args = ["export", input, "--out", output, ...(caseDef.options.type ? ["--type", caseDef.options.type] : []), ...(caseDef.options.m2ts ? ["--m2ts", caseDef.options.m2ts] : [])];
  else if (caseDef.options.operation === "render") args = ["render", input, "--out", output];
  else if (caseDef.options.operation === "validate") args = ["validate", input, "--format", "json"];
  else throw new Error(`Unsupported prepared CLI operation: ${caseDef.options.operation}`);
  let stdout, failure = null;
  const childReport = observeChild ? join(outputDir, `child-${sequence}-${process.pid}.json`) : null;
  const childEnvironment = childReport ? {
    ...process.env,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${pathToFileURL(join(root, "scripts/bench/runner/child-observer.mjs")).href}`].filter(Boolean).join(" "),
    BDMV2WEB_BENCH_CHILD_REPORT: childReport,
  } : process.env;
  try { stdout = execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, env: childEnvironment }); }
  catch (error) {
    const stderr = error?.stderr?.toString?.().trim() ?? "";
    // The floor case expects this exit; a measured case treats it as a failure.
    if (caseDef.options.operation !== "floor") throw new Error(`CLI ${args[0]} failed with exit ${error?.status ?? "unknown"}${stderr ? `: ${stderr}` : ""}`, { cause: error });
    // `validate` reports a failed audit as a JSON decision on stdout, so the floor
    // check looks at both streams.
    failure = { status: error?.status ?? null, stderr, stdout: error?.stdout?.toString?.() ?? "" };
    stdout = failure.stdout;
  }
  let child = null;
  if (childReport) {
    try { child = JSON.parse(await readFile(childReport, "utf8")); } catch { child = null; }
  }
  const childResult = child ? { child } : {};
  if (caseDef.options.operation === "floor") {
    const command = caseDef.options.command;
    if (!failure) throw new Error(`CLI ${command} accepted the missing input; a floor case has to fail`);
    if (!failure.status) throw new Error(`CLI ${command} exited ${failure.status ?? "without a status"} on the missing input`);
    // The path in the message proves the command module ran its input check
    // instead of failing earlier, in argument parsing.
    if (!`${failure.stderr}${failure.stdout}`.includes(basename(missingPath))) throw new Error(`CLI ${command} failed before reading the input: ${(failure.stderr || failure.stdout).split("\n")[0]}`);
    return { command: "floor", loaded: command, exitCode: failure.status, stderrBytes: Buffer.byteLength(failure.stderr), ...childResult };
  }
  const report = args[0] === "inspect" || args[0] === "validate" ? JSON.parse(stdout) : null;
  // `--version` exits before any command module loads, so it measures the
  // process start and argument parsing that every CLI case also pays for.
  if (args[0] === "--version") return { command: "version", stdoutBytes: Buffer.byteLength(stdout.trim()), output: null, ...childResult };
  if (args[0] === "inspect") {
    const { stageStatus } = report;
    const structureStatus = typeof stageStatus === "string" ? stageStatus : stageStatus?.structure;
    if (!["complete", "partial"].includes(structureStatus)) throw new Error(`CLI inspect structure status is ${String(structureStatus)}`);
  }
  if (args[0] === "list") {
    const clips = [...stdout.matchAll(/M2TS \d{5} ·/g)].length;
    if (!clips) throw new Error("CLI list printed no per-clip asset tree");
    return { command: "list", stdoutBytes: Buffer.byteLength(stdout), clips, ...childResult };
  }
  if (args[0] === "export" || args[0] === "render") {
    // A metadata-only disc export writes the analysis manifest; asset-side
    // exports and renders write the asset manifest.
    const assetSide = args[0] === "render" || caseDef.options.operation === "stream-export" || caseDef.options.operation === "bdmv-export";
    const stageReportPath = assetSide ? join(output, "assets-manifest.json") : join(output, "manifest.json");
    const stageReport = JSON.parse(await readFile(stageReportPath, "utf8"));
    if (stageReport.stageStatus === "failed" || stageReport.status === "failed") throw new Error(`CLI ${args[0]} stage status is failed`);
  }
  if (args[0] === "validate" && report.checks?.some((check) => check.result === "fail")) throw new Error("CLI validate reported failed package checks");
  if (!report) {
    const destination = args[args.indexOf("--out") + 1];
    const fileCount = await outputFileCount(destination);
    if (!fileCount) throw new Error(`${args[0]} CLI completed without creating output files`);
  }
  return { command: args[0], stdoutBytes: Buffer.byteLength(stdout), output, ...(args[0] === "validate" ? { checks: report.checks?.length ?? 0, decision: report.decision?.status ?? null } : {}), ...childResult };
}

export async function prepareScenarioCase(caseDef, root) {
  const { category, options, fixture } = caseDef;
  if (category === "scale" && caseDef.scope === "rle-decode") {
    const { decodeRle } = await readModule(root, "packages/igs/dist/scene/igs.js");
    const input = rleFixture(options.scale);
    return { input: { bytes: input.bytes.byteLength, width: input.width, height: input.height }, fixture, scope: caseDef.scope,
      run: () => decodeRle(input.bytes, input.width, input.height),
      validate: (value) => { if (value.byteLength !== input.width * input.height) throw new Error("RLE output dimensions differ from fixture"); return { bytes: value.byteLength }; },
      describe: (value) => ({ summary: `Decoded ${value.byteLength} indexed pixels`, details: { bytes: value.byteLength, width: input.width, height: input.height }, units: { value: value.byteLength, unit: "pixels" } }) };
  }
  if (category === "scale" && caseDef.scope === "png-encode-with-crc") {
    const { encodeRgbaPng } = await readModule(root, "packages/igs/dist/rendering/png.js");
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
    const { buildGraph } = await readModule(root, "packages/bdmv-parser/dist/parsing/parser.js");
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
    const { extractIgsFromChunks } = await readModule(root, "packages/igs/dist/scene/extract.js");
    const bytes = new Uint8Array(await readFile(fileFor(root, options.file)));
    const repeated = new Uint8Array(bytes.length * options.scale);
    for (let i = 0; i < options.scale; i++) repeated.set(bytes, i * bytes.length);
    const run = () => extractIgsFromChunks(options.clipId, packetChunks(repeated, 192 * 47), [{ pid: options.pid, source: { path: options.file, origin: "primary", offset: "0" } }], { chunkSize: 192 * 47, renderAssets: false });
    const packetCount = repeated.byteLength / options.packetSize;
    const sample = await run();
    if (!sample.scenes.length) throw new Error(`PES fixture yielded no IGS scenes at ${packetCount} packets`);
    const transport = transportStats(repeated);
    return { input: { transportBytes: repeated.byteLength, packets: packetCount, ...transport, scenes: sample.scenes.length, scale: options.scale }, fixture: { ...fixture, parameters: { ...fixture.parameters, packets: packetCount } }, scope: caseDef.scope,
      run,
      validate: (value) => { if (!Array.isArray(value.scenes)) throw new Error("IGS extraction returned no scenes collection"); return { scenes: value.scenes.length, diagnostics: value.diagnostics.length }; },
      describe: (value) => ({ summary: `Extracted ${value.scenes.length} scenes from ${packetCount} transport packets`, details: { transportBytes: repeated.byteLength, packets: packetCount, scenes: value.scenes.length, diagnostics: value.diagnostics.length } }) };
  }
  if (caseDef.scope === "pgs-track-extract") {
    const { extractPgsTracks } = await readModule(root, "packages/media-export/dist/pgs/pgs-extract.js");
    const temp = await mkdtemp(join(tmpdir(), "bdmv2web-bench-pgs-"));
    const source = new Uint8Array(await readFile(fileFor(root, options.input)));
    const clip = join(temp, "clip.m2ts");
    const grown = growWithRepeatedPackets(source, options.clipBytes);
    await writeFile(clip, grown);
    const requests = options.pids.map((pid) => ({ pid, outputPath: join(temp, `track-${pid.toString(16)}.sup`) }));
    const run = () => extractPgsTracks(clip, requests, {});
    const validate = (tracks) => {
      if (tracks.length !== requests.length) throw new Error(`SUP extraction returned ${tracks.length} tracks for ${requests.length} PIDs`);
      const sets = tracks.reduce((sum, track) => sum + track.displaySets.length, 0);
      const bytes = tracks.reduce((sum, track) => sum + track.byteLength, 0);
      if (!sets || !bytes) throw new Error("SUP extraction wrote no display sets");
      return { tracks: tracks.length, displaySets: sets, supBytes: bytes };
    };
    return {
      input: { clipBytes: grown.byteLength, packets: grown.byteLength / 192, pids: options.pids.map((pid) => `0x${pid.toString(16)}`).join(","), fill: "repeated-packets" },
      fixture, scope: caseDef.scope, run, validate,
      describe: (tracks) => ({ summary: `Extracted ${tracks.length} SUP tracks with ${tracks.reduce((sum, track) => sum + track.displaySets.length, 0)} display sets`, details: validate(tracks) }),
      afterMeasurement: () => rm(temp, { recursive: true, force: true }), cleanup: () => rm(temp, { recursive: true, force: true }),
    };
  }
  if (category === "cli") {
    const temp = await mkdtemp(join(tmpdir(), "bdmv2web-bench-cli-"));
    let sequence = 0;
    let packagePath;
    if (options.operation === "validate") {
      packagePath = join(temp, "synthetic-menu-package");
      const { buildSyntheticPackage } = await import("../runner/browser.mjs");
      await buildSyntheticPackage(root, packagePath);
    }
    let materialized;
    let inputPath = options.input;
    let transport = null;
    if (options.files) {
      const { materializeBdmvFiles } = await import("./fixture-input.mjs");
      materialized = await materializeBdmvFiles(caseDef.fixtureRoot ?? root, options.files);
      inputPath = materialized.directory;
    }
    const fixtureRoot = caseDef.fixtureRoot ?? root;
    if (options.operation === "list" || options.operation === "bdmv-export") { const grown = await grownDisc(fixtureRoot, options.input, temp, options.clips, options.clipBytes, options.fill ?? "repeated"); inputPath = grown.directory; transport = grown.transport; }
    if (options.operation === "stream-export") { const grown = await grownClip(fixtureRoot, options.input, temp, options.clipBytes, options.fill ?? "repeated"); inputPath = grown.file; transport = grown.transport; }
    // A whole-clip row is only informative while real packets dominate the input.
    assertScanInput(caseDef.caseId, transport, { ioCeiling: caseDef.ioCeiling === true });
    const cliCase = { ...caseDef, options: { ...options, input: inputPath, packagePath } };
    const childTotals = { calls: 0, gcEvents: 0, gcDurationMs: 0, maxPauseMs: 0, major: 0, minor: 0, heapUsedBytes: 0, rssBytes: 0, maxRSSBytes: 0, externalBytes: 0, durationMs: 0, available: true };
    const recordChild = (child) => {
      childTotals.calls++;
      childTotals.gcEvents += child.gc?.events?.length ?? 0;
      for (const event of child.gc?.events ?? []) {
        childTotals.gcDurationMs += event.durationMs ?? 0;
        childTotals.maxPauseMs = Math.max(childTotals.maxPauseMs, event.durationMs ?? 0);
        if (event.kind === 1) childTotals.minor++; else childTotals.major++;
      }
      childTotals.heapUsedBytes = Math.max(childTotals.heapUsedBytes, child.memory?.heapUsedBytes ?? 0);
      childTotals.rssBytes = Math.max(childTotals.rssBytes, child.memory?.rssBytes ?? 0);
      childTotals.maxRSSBytes = Math.max(childTotals.maxRSSBytes, child.memory?.maxRSSBytes ?? 0);
      childTotals.externalBytes = Math.max(childTotals.externalBytes, child.memory?.externalBytes ?? 0);
      childTotals.durationMs += child.durationMs ?? 0;
      childTotals.available &&= child.gc?.available !== false;
    };
    const childSummary = () => childTotals.calls ? {
      calls: childTotals.calls,
      available: childTotals.available,
      durationMs: childTotals.durationMs,
      gc: {
        events: childTotals.gcEvents, durationMs: childTotals.gcDurationMs, maxPauseMs: childTotals.maxPauseMs,
        major: childTotals.major, minor: childTotals.minor,
        msPerCall: childTotals.gcDurationMs / childTotals.calls,
      },
      memory: { heapUsedBytes: childTotals.heapUsedBytes, rssBytes: childTotals.rssBytes, maxRSSBytes: childTotals.maxRSSBytes, externalBytes: childTotals.externalBytes },
      scope: "all spawned CLI children in this fork, including preparation and warmup; per-call values divide by calls",
    } : null;
    const run = async () => {
      const value = await runCli(root, cliCase, temp, sequence++, options.observeChild === true);
      if (value.child) recordChild(value.child);
      return { ...value, child: childSummary() };
    };
    // `stream-export`, `bdmv-export`, and the floor rows are the `export` command on
    // different inputs; the record names the operation, the validation names the command.
    const cliCommand = options.operation === "floor" ? "floor"
      : options.operation === "stream-export" || options.operation === "bdmv-export" ? "export" : options.operation;
    const validate = (value) => { if (value.command !== cliCommand) throw new Error(`CLI ran ${value.command}; expected ${cliCommand}`); return { command: value.command, stdoutBytes: value.stdoutBytes, ...(value.clips === undefined ? {} : { clips: value.clips }) }; };
    const describe = (value) => options.operation === "floor"
      ? { summary: `${value.loaded} CLI loaded and rejected a missing input`, details: { command: value.loaded, exitCode: value.exitCode, stderrBytes: value.stderrBytes } }
      : { summary: `${value.command} CLI completed`, details: { command: value.command, stdoutBytes: value.stdoutBytes, ...(value.clips === undefined ? {} : { clips: value.clips }), ...(value.checks === undefined ? {} : { checks: value.checks, decision: value.decision }) } };
    const cleanup = async () => { await materialized?.cleanup(); await rm(temp, { recursive: true, force: true }); };
    const fixturePath = toPortablePath(root, inputPath);
    const input = { command: options.operation, ...(options.operation === "floor" ? { loaded: options.command } : {}), ...(options.files ? { metadataFileCount: options.files.length } : {}), ...(options.clipBytes ? { clipBytes: options.clipBytes, clips: options.clips ?? 1, fill: options.fill ?? "repeated" } : {}), ...(transport ? { transport } : {}), ...(fixturePath ? { fixturePath } : {}), ...(options.operation === "validate" ? { packageBuilder: "assembleMenuPackage" } : {}) };
    return { input, fixture, scope: caseDef.scope, run, validate, describe, afterMeasurement: cleanup, cleanup };
  }
  if (category === "browser") {
    const { prepareBrowserScenario } = await import("../runner/browser.mjs");
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
