#!/usr/bin/env node
import { link, lstat, mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { assertDisjointRoots, beginOutputTransaction, resolveInputFile } from "@bdmv2web/bdmv-io";
import { ContractError, DEFAULT_PLAYER_PROFILE, parseDiscIR, type DiscIR, type PlayerProfile } from "@bdmv2web/core";
import { parseBdmv, type ParsedDisc } from "@bdmv2web/bdmv-parser";
import { encodeRgbaPng, extractIgsScenes } from "@bdmv2web/igs";
import { buildNavigationGraph, HdmvVm, profileWord } from "@bdmv2web/hdmv";
import { computeMediaClosure, createExternalMediaTargets, extractPgsTrack, resolveMenuLoopStart45k, type PgsDisplaySet } from "@bdmv2web/media-export";
import { buildMenuPackage } from "@bdmv2web/package-builder";
import { adaptIgsScene } from "@bdmv2web/runtime-web";
import { auditOutputPackage, classifyDiagnostics, createDependencyAuditReport, createReleaseSummary, decideDelivery, decideStageOutcome, summarizeDeliveryCoverage, type DeliveryDiagnostic } from "@bdmv2web/test-runner";

const argv = process.argv.slice(2);
const command = argv[0];
const supported = new Set(["inspect", "extract", "convert", "validate", "compare", "list-assets", "export-assets"]);

/** Per-command option contract. Anything else is a typo, not a silent no-op. */
const commandOptions: Record<string, { flags: ReadonlySet<string>; values: ReadonlySet<string> }> = {
  inspect: { flags: new Set(["--strict", "--no-strict", "--allow-partial"]), values: new Set(["--out", "--format"]) },
  extract: { flags: new Set(["--strict", "--no-strict", "--all"]), values: new Set(["--out", "--format", "--type"]) },
  convert: { flags: new Set(["--strict", "--no-strict", "--overwrite"]), values: new Set(["--out", "--player-profile", "--limits", "--title", "--format"]) },
  validate: { flags: new Set(["--strict", "--no-strict", "--offline"]), values: new Set(["--format"]) },
  compare: { flags: new Set(["--strict", "--no-strict"]), values: new Set(["--mode", "--format"]) },
  "list-assets": { flags: new Set([]), values: new Set(["--type", "--format", "--out", "--m2ts", "--pid", "--decode"]) },
  "export-assets": { flags: new Set([]), values: new Set(["--type", "--out", "--format", "--m2ts", "--pid", "--decode"]) },
};

/**
 * Validate the raw argument vector before any command runs. A misspelled flag
 * (`--stric`, `--ou`) must fail instead of silently changing behaviour, and an
 * extra positional argument must not be dropped.
 */
function validateCommandLine(): void {
  const spec = commandOptions[command!];
  if (!spec) return;
  let positionals = 0;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) { positionals++; continue; }
    const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (!spec.flags.has(name) && !spec.values.has(name)) fail("CLI_UNKNOWN_OPTION", `Unknown option ${name} for '${command}'`);
    if (spec.values.has(name) && !arg.includes("=")) {
      const next = argv[i + 1];
      if (next !== undefined && next !== "" && !next.startsWith("--")) i++;
    }
  }
  if (positionals > 1) fail("CLI_USAGE", `The '${command}' command accepts one input path but received ${positionals} arguments`);
}
function lookupOption(name: string): { found: boolean; value: string | undefined } {
  const index = argv.findIndex((value) => value === name || value.startsWith(`${name}=`));
  if (index < 0) return { found: false, value: undefined };
  const arg = argv[index]!;
  // `--flag=` carries no value, so it must behave like a bare flag instead of
  // supplying an empty string to path and enum options.
  if (arg.includes("=")) {
    const inline = arg.slice(arg.indexOf("=") + 1);
    return { found: true, value: inline === "" ? undefined : inline };
  }
  const next = argv[index + 1];
  return { found: true, value: next === undefined || next === "" || next.startsWith("--") ? undefined : next };
}
function optionValue(name: string): string | undefined {
  const option = lookupOption(name);
  if (!option.found) return undefined;
  if (option.value === undefined) fail("CLI_MISSING_VALUE", `${name} requires a value`);
  return option.value;
}
/** Non-throwing lookup for the error handler, which must not fail while formatting a failure. */
function rawOptionValue(name: string): string | undefined {
  return lookupOption(name).value;
}
function strictDefault(): boolean {
  if (argv.includes("--strict")) return true;
  if (argv.includes("--no-strict")) return false;
  return false;
}
function inputPath(): string | undefined {
  const takesValue = new Set(["--format", "--out", "--player-profile", "--limits", "--title", "--type", "--m2ts", "--pid", "--decode"]);
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) { if (!arg.includes("=") && takesValue.has(arg)) i++; continue; }
    return arg;
  }
  return undefined;
}
function fail(code: string, message: string, path?: string): never {
  throw new ContractError(code, path ?? "/", message);
}

function outputFormat(commandName: string, defaultFormat: "table" | "json" = "table"): "table" | "json" {
  const value = optionValue("--format") ?? defaultFormat;
  if (value !== "table" && value !== "json") fail("CLI_INVALID_FORMAT", `${commandName} supports 'table' or 'json' for --format, got '${value}'`);
  return value;
}

function printTable(title: string, columns: string[], rows: Array<Array<string | number | null | undefined>>): void {
  const values = rows.map((row) => row.map((value) => value === null || value === undefined ? "-" : String(value)));
  const widths = columns.map((column, i) => Math.max(column.length, ...values.map((row) => row[i]?.length ?? 0)));
  process.stdout.write(`${title}\n`);
  process.stdout.write(`${columns.map((column, i) => column.padEnd(widths[i]!)).join("  ")}\n`);
  process.stdout.write(`${widths.map((width) => "-".repeat(width)).join("  ")}\n`);
  for (const row of values) process.stdout.write(`${row.map((value, i) => value.padEnd(widths[i]!)).join("  ")}\n`);
}

async function writeJsonFile(targetPath: string, json: string): Promise<void> {
  const target = resolve(targetPath);
  const temp = resolve(dirname(target), `.${basename(target)}.tmp-${process.pid}`);
  try { await writeFile(temp, json, { flag: "wx" }); await link(temp, target); await unlink(temp); }
  catch (error) { await rm(temp, { force: true }); throw error; }
}

/** Read and validate a `PlayerProfile` JSON file; a profile is either fully declared or absent. */
async function loadPlayerProfile(path: string | undefined): Promise<PlayerProfile> {
  if (path === undefined) return { ...DEFAULT_PLAYER_PROFILE, videoProfiles: [], audioProfiles: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolve(path), "utf8"));
  } catch (error) {
    throw new ContractError("CLI_INVALID_PROFILE", "/", `--player-profile could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new ContractError("CLI_INVALID_PROFILE", "/", "--player-profile must contain a JSON object");
  const record = parsed as Record<string, unknown>;
  // Reuse the PSR word rules instead of accepting any non-empty string: these
  // values become PSR16-19, and a semantically invalid value can only fail later
  // as an opaque E_IO when the VM is constructed (D-11).
  const menuLanguage = profileWordField(record, "menuLanguage", 3);
  const audioLanguage = profileWordField(record, "audioLanguage", 3);
  const subtitleLanguage = profileWordField(record, "subtitleLanguage", 3);
  const country = profileWordField(record, "country", 2, true);
  if (typeof record.outputProfile !== "string" || record.outputProfile === "") throw new ContractError("CLI_INVALID_PROFILE", "/outputProfile", "--player-profile requires a non-empty string 'outputProfile'");
  if (!["A", "B", "C"].includes(record.region as string)) throw new ContractError("CLI_INVALID_PROFILE", "/region", "--player-profile requires region A, B, or C");
  if (record.outputProfile !== "portable") throw new ContractError("CLI_INVALID_PROFILE", "/outputProfile", "--player-profile supports only the 'portable' output profile");
  for (const key of ["videoProfiles", "audioProfiles"] as const) {
    const value = record[key];
    if (value !== undefined && (!Array.isArray(value) || !value.every((item) => typeof item === "string"))) throw new ContractError("CLI_INVALID_PROFILE", `/${key}`, `--player-profile requires '${key}' to be a string array`);
  }
  return {
    menuLanguage,
    audioLanguage,
    subtitleLanguage,
    country,
    region: record.region as PlayerProfile["region"],
    outputProfile: "portable",
    videoProfiles: (record.videoProfiles as string[] | undefined) ?? [],
    audioProfiles: (record.audioProfiles as string[] | undefined) ?? [],
  };
}

/**
 * Validate one profile word with the same rules the register file applies
 * (exact ASCII letter length), normalising case so `ENG`/`us` behave like
 * `eng`/`US` instead of producing a different PSR word.
 */
function profileWordField(record: Record<string, unknown>, key: string, width: number, uppercase = false): string {
  const value = record[key];
  if (typeof value !== "string" || value === "") throw new ContractError("CLI_INVALID_PROFILE", `/${key}`, `--player-profile requires a non-empty string '${key}'`);
  const normalized = uppercase ? value.toUpperCase() : value.toLowerCase();
  try {
    profileWord(normalized, width, key);
  } catch {
    throw new ContractError("CLI_INVALID_PROFILE", `/${key}`, `--player-profile requires '${key}' to be ${width} ASCII letters`);
  }
  return normalized;
}

function deliveryDiagnostics(diagnostics: ReadonlyArray<{ code: string; message: string; severity?: string }>): DeliveryDiagnostic[] {
  return diagnostics.map((item) => ({
    severity: item.severity ?? "warning",
    code: item.code,
    message: item.message,
  }));
}

function firstBlockingCode(diagnostics: DeliveryDiagnostic[]): string {
  return diagnostics.find((item) => item.severity.toLowerCase() === "fatal")?.code ?? diagnostics[0]?.code ?? "STAGE_FAILED";
}

function stageFailure(code: string, diagnostics: DeliveryDiagnostic[]): void {
  // `status` is reserved for delivery conclusions (convert/validate); a stage only
  // reports whether its own goal was reached (D-5).
  process.stdout.write(`${JSON.stringify({ stageStatus: "failed", code, diagnostics })}\n`);
  process.exitCode = 1;
}

async function inspect(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "inspect requires an input path");
  // Argument contract first: a missing flag value must not be masked by stage output.
  const out = optionValue("--out");
  const format = outputFormat("inspect");
  const strict = strictDefault();
  const allowPartial = argv.includes("--allow-partial");
  const disc = await parseBdmv(input);
  const outcome = decideStageOutcome({ stage: "inspect", diagnostics: disc.diagnostics, strict });
  if (outcome.status === "failed" && !allowPartial) {
    stageFailure(firstBlockingCode(outcome.blockingDiagnostics), outcome.blockingDiagnostics);
    return;
  }
  const json = `${JSON.stringify({ ...disc, stageStatus: outcome.status }, null, 2)}\n`;
  if (out) { const target = resolve(out); await assertDisjointRoots(disc.root, target); await writeJsonFile(target, json); }
  if (format === "json") process.stdout.write(json);
  else printTable("BDMV inspection", ["Section", "Count / Status"], [
    ["Analysis", disc.analysisStage], ["Delivery", outcome.status], ["Entries", disc.declarations.entries],
    ["MovieObjects", disc.declarations.movieObjects], ["Playlists", disc.declarations.playlists],
    ["PlayItems", disc.declarations.playItems], ["Clips", disc.declarations.clips],
    ["Streams", disc.declarations.streams], ["Sounds", disc.declarations.sounds],
    ["Diagnostics", disc.diagnostics.length], ["Support prediction", disc.supportPrediction.status],
  ]);
  process.exitCode = allowPartial ? 0 : outcome.exitCode;
}

function buildMediaClosure(disc: ParsedDisc, scenes: Awaited<ReturnType<typeof extractIgsScenes>>["scenes"]) {
  const programs = scenes.flatMap((scene) => scene.pages.flatMap((page) => page.buttons.filter((button) => button.commands.length).map((button) => ({ scene, button }))));
  const graphs = programs.map(({ scene, button }, id) => buildNavigationGraph([{ id, instructions: button.commands.map((command) => {
    const bytes = Buffer.from(command.bytes); const words: [number, number, number] = [bytes.readUInt32BE(0), bytes.readUInt32BE(4), bytes.readUInt32BE(8)];
    return { bytes: bytes.toString("hex"), words, source: { path: `BDMV/STREAM/${scene.clipId}.m2ts`, origin: "primary" as const, offset: command.sourceOffset } };
  }) }]));
  return computeMediaClosure(disc, buildNavigationGraph(disc.movieObjects, [], { entries: disc.entries }), graphs);
}

function buildExternalTargets(disc: ParsedDisc, scenes: Awaited<ReturnType<typeof extractIgsScenes>>["scenes"]) {
  return createExternalMediaTargets(disc, buildMediaClosure(disc, scenes));
}

async function extractReachablePgsTracks(disc: ParsedDisc, scenes: Awaited<ReturnType<typeof extractIgsScenes>>["scenes"], outputDirectory: string, pathForReference?: (reference: ReturnType<typeof reachablePgsReferences>[number], index: number) => string, selectedReferences?: ReturnType<typeof reachablePgsReferences>) {
  const references = selectedReferences ?? reachablePgsReferences(disc, scenes);
  const extracted = new Map<string, Awaited<ReturnType<typeof extractPgsTrack>> & { packagePath: string }>();
  const result = [];
  for (const [index, reference] of references.entries()) {
    const key = `${reference.clipId.toLocaleLowerCase("en-US")}:${reference.pid}`;
    let track = extracted.get(key);
    if (!track) {
      const sourcePath = await resolveInputFile(disc.root, `STREAM/${reference.clipId}.m2ts`);
      const relativePath = pathForReference?.(reference, index) ?? `assets/subtitles/${reference.clipId}-${reference.pid.toString(16)}.sup`;
      track = { ...await extractPgsTrack(sourcePath, reference.pid, resolve(outputDirectory, relativePath), { timestampOffset90k: BigInt(reference.sourceIn90k) }), packagePath: relativePath };
      extracted.set(key, track);
    }
    result.push({ ...reference, path: track.packagePath, displaySets: track.displaySets });
  }
  return result;
}

function reachablePgsReferences(disc: ParsedDisc, scenes: Awaited<ReturnType<typeof extractIgsScenes>>["scenes"]) {
  const closure = buildMediaClosure(disc, scenes);
  return closure.playlistIds.flatMap((nodeId) => {
    const playlistId = nodeId.slice("playlist:".length);
    const playlist = disc.playlists.find((item) => item.id.toLocaleLowerCase("en-US") === playlistId.toLocaleLowerCase("en-US"));
    return playlist?.playItems.flatMap((item) => item.streams.filter((stream) => stream.pid !== null && stream.streamType === 1 && stream.codingType === 0x90)
      .map((stream, index) => ({ playlistId, playlistNumber: Number(playlistId), playItemIndex: item.index, clipId: item.clipId, pid: stream.pid!, streamNumber: index + 1, language: stream.language ?? "und", sourceIn90k: String(item.inTime45k * 2), sourceOut90k: String(item.outTime45k * 2), source: `BDMV/STREAM/${item.clipId}.m2ts` }))) ?? [];
  });
}

type AssetType = "all" | "igs" | "sup";
function assetTypeOption(): AssetType {
  const value = optionValue("--type") ?? "all";
  if (value !== "all" && value !== "igs" && value !== "sup") fail("CLI_INVALID_ASSET_TYPE", "--type must be one of all, igs, or sup");
  return value;
}

function assetSelection(): { clipId?: string; pid?: number; decodePng: boolean } {
  const rawClip = optionValue("--m2ts");
  const clipValue = rawClip?.replace(/\.m2ts$/i, "");
  if (clipValue !== undefined && !/^\d{1,5}$/.test(clipValue)) fail("CLI_INVALID_M2TS", "--m2ts must be a clip ID such as 00001");
  const clipId = clipValue?.padStart(5, "0");
  const rawPid = optionValue("--pid");
  let pid: number | undefined;
  if (rawPid !== undefined) {
    if (!/^(?:0x[\da-f]{1,4}|\d{1,4})$/i.test(rawPid)) fail("CLI_INVALID_PID", "--pid must be a decimal PID or hexadecimal value such as 0x0120");
    pid = Number(rawPid.toLowerCase().startsWith("0x") ? rawPid : Number(rawPid));
    if (!Number.isInteger(pid) || pid < 0x20 || pid > 0x1ffe) fail("CLI_INVALID_PID", "--pid must be between 0x0020 and 0x1ffe");
  }
  const decode = optionValue("--decode");
  if (decode !== undefined && decode !== "png") fail("CLI_INVALID_DECODE", "--decode supports only 'png'");
  return { ...(clipId ? { clipId } : {}), ...(pid === undefined ? {} : { pid }), decodePng: decode === "png" };
}

function selectedClip(clipId: string, selection: { clipId?: string }): boolean { return selection.clipId === undefined || selection.clipId.toLocaleLowerCase("en-US") === clipId.toLocaleLowerCase("en-US"); }
function selectedPid(pid: number, selection: { pid?: number }): boolean { return selection.pid === undefined || selection.pid === pid; }

async function listAssets(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "list-assets requires a BDMV input path");
  const type = assetTypeOption();
  const selection = assetSelection();
  const format = outputFormat("list-assets");
  const out = optionValue("--out");
  const disc = await parseBdmv(input);
  const fatal = classifyDiagnostics(disc.diagnostics);
  if (fatal.hasFatal) { stageFailure(firstBlockingCode(fatal.blocking), fatal.blocking); return; }
  const extraction = await extractIgsScenes(disc, { renderAssets: selection.decodePng && type !== "sup" });
  const scenes = extraction.scenes.filter((scene) => selectedClip(scene.clipId, selection) && selectedPid(scene.pid, selection));
  const igsStreams = type === "sup" ? [] : extraction.streams.filter((stream) => selectedClip(stream.clipId, selection) && selectedPid(stream.pid, selection)).map((stream) => ({ type: "igs", format: "mnu", path: igsMnuPath(stream.clipId, stream.pid), clipId: stream.clipId, pid: stream.pid, byteLength: stream.byteLength }));
  const igsElements = type === "sup" ? [] : scenes.flatMap((scene) => scene.objects.map((object) => ({ type: "igs-image-element", clipId: scene.clipId, pid: scene.pid, sceneId: scene.id, compositionNumber: scene.compositionNumber, objectId: object.id, objectVersion: object.version, width: object.width, height: object.height })));
  const igsPngs = type === "sup" || !selection.decodePng ? [] : extraction.assets.filter((asset) => selectedClip(asset.source.clipId, selection) && selectedPid(asset.source.pid, selection)).map((asset) => ({ type: "igs-png", path: asset.relativePath, clipId: asset.source.clipId, pid: asset.source.pid, objectId: asset.objectId, objectVersion: asset.objectVersion, paletteId: asset.paletteId, paletteVersion: asset.paletteVersion, width: asset.width, height: asset.height, byteLength: asset.pngBytes.byteLength }));
  const references = type === "igs" ? [] : uniquePgsReferences(reachablePgsReferences(disc, extraction.scenes)).filter((item) => selectedClip(item.clipId, selection) && selectedPid(item.pid, selection));
  const subtitles = references.map((item, index) => ({ type: "sup", path: supTrackPath(item.clipId, item.pid, index), clipId: item.clipId, pid: item.pid, language: item.language, streamNumber: item.streamNumber, playlistId: item.playlistId, playItemIndex: item.playItemIndex }));
  const supPngs: Array<{ type: string; path: string; clipId: string; pid: number; displaySet: number }> = [];
  if (selection.decodePng && type !== "igs" && references.length) {
    const temp = await mkdtemp(resolve(tmpdir(), "bdmv-list-assets-"));
    try {
      const tracks = await extractReachablePgsTracks(disc, extraction.scenes, temp, (_reference, index) => `tracks/${index}.sup`, references);
      for (const track of [...new Map(tracks.map((entry) => [entry.path, entry])).values()]) track.displaySets.forEach((_, index) => supPngs.push({ type: "sup-png", path: supDisplaySetPath(track.clipId, track.pid, track.language, index), clipId: track.clipId, pid: track.pid, displaySet: index + 1 }));
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
  const perM2ts = [...new Set(subtitles.map((asset) => asset.clipId))].map((clipId) => ({ clipId, subtitleTrackCount: subtitles.filter((asset) => asset.clipId === clipId).length }));
  const assets = [...igsStreams, ...igsPngs, ...subtitles, ...supPngs];
  const report = { schemaVersion: "1.0", decode: selection.decodePng ? "png" : "none", summary: { igsScenes: type === "sup" ? 0 : scenes.length, igsStreams: igsStreams.length, igsImageElements: igsElements.length, supTracks: subtitles.length, supDisplaySetPngs: supPngs.length, m2tsWithSup: perM2ts.length, perM2ts }, assets, igsImageElements: igsElements };
  if (out) { await assertDisjointRoots(disc.root, resolve(out)); await writeJsonFile(out, `${JSON.stringify(report, null, 2)}\n`); }
  if (format === "json") process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    printTable("Asset summary", ["Type", "Count"], [["IGS streams", report.summary.igsStreams], ["IGS scenes", report.summary.igsScenes], ["IGS image elements", report.summary.igsImageElements], ["SUP tracks", report.summary.supTracks], ["SUP display set PNGs", report.summary.supDisplaySetPngs], ["M2TS with SUP", report.summary.m2tsWithSup]]);
    printTable("Assets", ["Type", "Clip", "PID", "Language", "Bytes", "Path"], assets.map((asset) => [asset.type, "clipId" in asset ? asset.clipId : "-", "pid" in asset ? `0x${asset.pid.toString(16)}` : "-", "language" in asset ? asset.language : "-", "byteLength" in asset ? asset.byteLength : "-", "path" in asset ? asset.path : "-"]));
    printTable("IGS image elements", ["Clip", "PID", "Scene", "Composition", "Object", "Version", "Dimensions"], igsElements.map((item) => [item.clipId, `0x${item.pid.toString(16)}`, item.sceneId, item.compositionNumber, item.objectId, item.objectVersion, `${item.width}x${item.height}`]));
    printTable("SUP tracks by M2TS", ["Clip", "SUP tracks"], perM2ts.map((item) => [item.clipId, item.subtitleTrackCount]));
  }
}

async function exportAssets(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "export-assets requires a BDMV input path");
  const out = optionValue("--out"); if (!out) fail("CLI_MISSING_OUTPUT", "export-assets requires --out DIR");
  const type = assetTypeOption();
  const selection = assetSelection();
  const disc = await parseBdmv(input);
  const facts = classifyDiagnostics(disc.diagnostics);
  if (facts.hasFatal) { stageFailure(firstBlockingCode(facts.blocking), facts.blocking); return; }
  const roots = await assertDisjointRoots(disc.root, resolve(out));
  const igs = await extractIgsScenes(disc, { renderAssets: selection.decodePng && type !== "sup", captureStreams: type !== "sup" });
  const outcome = decideStageOutcome({ stage: "extract", diagnostics: [...disc.diagnostics, ...igs.diagnostics], strict: strictDefault() });
  if (outcome.status === "failed") { stageFailure(firstBlockingCode(outcome.blockingDiagnostics), outcome.blockingDiagnostics); return; }
  const transaction = await beginOutputTransaction(roots.output);
  try {
    const files: Array<{ type: string; format?: string; path: string; byteLength: number; language?: string; streamNumber?: number; displaySetCount?: number }> = [];
    if (type !== "sup") for (const stream of igs.streams.filter((item) => selectedClip(item.clipId, selection) && selectedPid(item.pid, selection))) {
      const path = igsMnuPath(stream.clipId, stream.pid);
      const target = resolve(transaction.stagingPath, path);
      await mkdir(dirname(target), { recursive: true });
      if (!stream.bytes) throw new Error(`Raw IGS bytes were not retained for ${stream.clipId} PID ${stream.pid}`);
      await writeFile(target, stream.bytes, { flag: "wx" });
      files.push({ type: "igs", format: "mnu", path, byteLength: stream.byteLength });
    }
    for (const asset of igs.assets.filter((item) => selectedClip(item.source.clipId, selection) && selectedPid(item.source.pid, selection))) {
      const path = asset.relativePath;
      const target = resolve(transaction.stagingPath, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, asset.pngBytes, { flag: "wx" });
      files.push({ type: "igs-png", path, byteLength: asset.pngBytes.byteLength });
    }
    if (type !== "igs") {
      const references = uniquePgsReferences(reachablePgsReferences(disc, igs.scenes)).filter((item) => selectedClip(item.clipId, selection) && selectedPid(item.pid, selection));
      const exportPaths = new Map(references.map((reference, index) => [`${reference.clipId.toLocaleLowerCase("en-US")}:${reference.pid}`, supTrackPath(reference.clipId, reference.pid, index)]));
      const tracks = await extractReachablePgsTracks(disc, igs.scenes, transaction.stagingPath, (reference) => exportPaths.get(`${reference.clipId.toLocaleLowerCase("en-US")}:${reference.pid}`)!, references);
      const uniqueTracks = [...new Map(tracks.map((track) => [track.path, track])).values()];
      for (const track of uniqueTracks) {
        const trackStat = await lstat(resolve(transaction.stagingPath, track.path));
        files.push({ type: "sup", path: track.path, byteLength: trackStat.size, language: track.language, streamNumber: track.streamNumber, displaySetCount: track.displaySets.length });
        if (selection.decodePng) for (const [index, displaySet] of track.displaySets.entries()) {
          const path = supDisplaySetPath(track.clipId, track.pid, track.language, index);
          const target = resolve(transaction.stagingPath, path);
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, renderPgsDisplaySet(displaySet), { flag: "wx" });
          files.push({ type: "sup-png", path, byteLength: (await stat(target)).size, language: track.language, streamNumber: track.streamNumber });
        }
      }
    }
    await writeFile(resolve(transaction.stagingPath, "assets-manifest.json"), `${JSON.stringify({ schemaVersion: "1.0", assets: files }, null, 2)}\n`, { flag: "wx" });
    await transaction.commit();
    process.stdout.write(`${JSON.stringify({ stageStatus: outcome.status, output: roots.output, assetCount: files.length })}\n`);
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
  } catch (error) { await transaction.abort(); throw error; }
}

function uniquePgsReferences(references: ReturnType<typeof reachablePgsReferences>): ReturnType<typeof reachablePgsReferences> {
  return [...new Map(references.map((reference) => [`${reference.clipId.toLocaleLowerCase("en-US")}:${reference.pid}`, reference])).values()];
}

function safeAssetLanguage(language: string): string { return /^[a-z]{3}$/i.test(language) ? language.toLowerCase() : "und"; }
function igsMnuPath(clipId: string, pid: number): string { return `assets/igs/${clipId}-pid-${pid.toString(16).padStart(4, "0")}.mnu`; }
function supTrackPath(clipId: string, pid: number, _index: number): string { return `assets/subtitles/${clipId}-pid-${pid.toString(16).padStart(4, "0")}.sup`; }
function supDisplaySetPath(clipId: string, pid: number, language: string, index: number): string {
  return `assets/subtitles/${clipId}-pid-${pid.toString(16).padStart(4, "0")}-${safeAssetLanguage(language)}-display-${String(index + 1).padStart(5, "0")}.png`;
}

function renderPgsDisplaySet(display: PgsDisplaySet): Uint8Array {
  const rgba = new Uint8Array(display.width * display.height * 4);
  for (const placement of display.placements) {
    const bitmap = display.bitmaps.get(placement.objectId);
    if (!bitmap) continue;
    const crop = placement.crop ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
    for (let sy = 0; sy < crop.height; sy++) for (let sx = 0; sx < crop.width; sx++) {
      const dx = placement.x + sx; const dy = placement.y + sy;
      const sourceX = crop.x + sx; const sourceY = crop.y + sy;
      if (dx < 0 || dy < 0 || dx >= display.width || dy >= display.height || sourceX >= bitmap.width || sourceY >= bitmap.height) continue;
      const sourceOffset = (sourceY * bitmap.width + sourceX) * 4;
      const targetOffset = (dy * display.width + dx) * 4;
      const sourceAlpha = bitmap.pixels[sourceOffset + 3]! / 255;
      if (sourceAlpha === 0) continue;
      const targetAlpha = rgba[targetOffset + 3]! / 255;
      const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
      for (let channel = 0; channel < 3; channel++) {
        rgba[targetOffset + channel] = Math.round((bitmap.pixels[sourceOffset + channel]! * sourceAlpha + rgba[targetOffset + channel]! * targetAlpha * (1 - sourceAlpha)) / outputAlpha);
      }
      rgba[targetOffset + 3] = Math.round(outputAlpha * 255);
    }
  }
  return encodeRgbaPng(display.width, display.height, rgba);
}

async function extract(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "extract requires an input path");
  const out = optionValue("--out"); if (!out) fail("CLI_MISSING_OUTPUT", "extract requires --out DIR");
  const selectedType = optionValue("--type");
  const all = argv.includes("--all");
  if (all === (selectedType !== undefined)) fail("CLI_EXTRACT_SELECTION", "extract requires exactly one of --type hdmv|igs|sup or --all");
  if (selectedType !== undefined && !["hdmv", "igs", "sup"].includes(selectedType)) fail("CLI_INVALID_EXTRACT_TYPE", "--type must be one of hdmv, igs, or sup");
  const includeHdmv = all || selectedType === "hdmv";
  const includeIgs = all || selectedType === "igs";
  const includeSup = all || selectedType === "sup";
  const strict = strictDefault();
  const disc = await parseBdmv(input);
  const roots = await assertDisjointRoots(disc.root, resolve(out));
  // Fail on fatal parse diagnostics before scanning STREAM data (P2-INFO-3).
  const parseFacts = classifyDiagnostics(disc.diagnostics);
  if (parseFacts.hasFatal) { stageFailure(firstBlockingCode(parseFacts.blocking), parseFacts.blocking); return; }
  const needsIgs = includeIgs || includeSup;
  const igs = needsIgs ? await extractIgsScenes(disc, { renderAssets: false }) : { scenes: [], assets: [], diagnostics: [], status: "complete" as const, support: { format: "Blu-ray IGS" as const, status: "unverified" as const } };
  const stageDiagnostics = [...disc.diagnostics, ...(includeIgs || includeSup ? igs.diagnostics : [])];
  const outcome = decideStageOutcome({ stage: "extract", diagnostics: stageDiagnostics, strict });
  if (outcome.status === "failed") {
    stageFailure(firstBlockingCode(outcome.blockingDiagnostics), outcome.blockingDiagnostics);
    return;
  }
  const transaction = await beginOutputTransaction(roots.output);
  try {
    const generatedFiles: Array<{ path: string; kind: string; byteLength: string }> = [];
    if (includeHdmv) {
    const hdmvRoot = resolve(transaction.stagingPath, "hdmv"); await mkdir(hdmvRoot, { recursive: true });
    const commandTable = disc.movieObjects.flatMap((object) => object.instructions.map((instruction, instructionIndex) => ({ movieObjectId: object.id, instructionIndex, words: instruction.words, bytes: instruction.bytes, source: instruction.source })));
    const raw = `${JSON.stringify(commandTable, null, 2)}\n`;
    const rawPath = resolve(transaction.stagingPath, "hdmv/commands.json");
    await writeFile(rawPath, raw, { flag: "wx" });
    const parsedPath = "hdmv/parsed-disc.json";
    await writeFile(resolve(transaction.stagingPath, parsedPath), `${JSON.stringify(disc, null, 2)}\n`, { flag: "wx" });
    generatedFiles.push(await generatedFileRecord(transaction.stagingPath, parsedPath, "parsed-disc"), await generatedFileRecord(transaction.stagingPath, "hdmv/commands.json", "hdmv-command-table"));
    if (all) {
      const externalPath = "hdmv/external-media-targets.json";
      await writeFile(resolve(transaction.stagingPath, externalPath), `${JSON.stringify(buildExternalTargets(disc, igs.scenes), null, 2)}\n`, { flag: "wx" });
      generatedFiles.push(await generatedFileRecord(transaction.stagingPath, externalPath, "external-media-targets"));
    }
    }
    if (includeIgs) {
    const sceneRecords = igs.scenes.map((scene) => ({ id: scene.id, raw: serializeIgsScene(scene) }));
    const sceneJson = `${JSON.stringify({ schemaVersion: "1.0", status: igs.status, support: igs.support, scenes: sceneRecords }, null, 2)}\n`;
    const diagnosticRecords = igs.diagnostics.map((item) => ({ ...item, message: safeDiagnosticMessage(item.message, roots.input) }));
    const diagnosticsJson = `${JSON.stringify({ schemaVersion: "1.0", status: igs.status, diagnostics: diagnosticRecords }, null, 2)}\n`;
    const sourceMap = {
      schemaVersion: "1.0",
      scenes: igs.scenes.map((scene) => ({ sceneId: scene.id, composition: mapIgsSource(scene.source), pages: scene.pages.map((page) => ({ pageId: page.id, buttons: page.buttons.map((button) => ({ buttonId: button.id, commands: button.commands.map((command) => ({ recordIndex: command.recordIndex, sourceOffset: command.sourceOffset, source: mapIgsSource(scene.source) })) })) })), objects: scene.objects.map((object) => ({ objectId: object.id, version: object.version, source: mapIgsSource(object.source) })), palettes: scene.palettes.map((palette) => ({ paletteId: palette.id, version: palette.version, source: mapIgsSource(palette.source) })) })),
      assets: igs.assets.map((asset) => ({ assetId: asset.id, path: asset.relativePath, objectId: asset.objectId, objectVersion: asset.objectVersion, paletteId: asset.paletteId, paletteVersion: asset.paletteVersion, source: mapIgsSource(asset.source), colorConversion: asset.colorConversion })),
      diagnostics: igs.diagnostics.map((diagnostic, index) => ({ index, source: diagnostic.source ? mapIgsSource(diagnostic.source) : null, affectedSceneIds: diagnostic.affectedSceneIds })),
    };
    const sourceMapJson = `${JSON.stringify(sourceMap, null, 2)}\n`;
    await mkdir(resolve(transaction.stagingPath, "igs"), { recursive: true });
    await writeFile(resolve(transaction.stagingPath, "igs/scenes.json"), sceneJson, { flag: "wx" });
    await writeFile(resolve(transaction.stagingPath, "igs/diagnostics.json"), diagnosticsJson, { flag: "wx" });
    await writeFile(resolve(transaction.stagingPath, "igs/source-map.json"), sourceMapJson, { flag: "wx" });
    generatedFiles.push(await generatedFileRecord(transaction.stagingPath, "igs/scenes.json", "igs-scenes"), await generatedFileRecord(transaction.stagingPath, "igs/diagnostics.json", "igs-diagnostics"), await generatedFileRecord(transaction.stagingPath, "igs/source-map.json", "source-map"));
    }
    if (includeSup) {
      const references = uniquePgsReferences(reachablePgsReferences(disc, igs.scenes));
      const tracks = await extractReachablePgsTracks(disc, igs.scenes, transaction.stagingPath, (reference, index) => `sup/${reference.clipId}-pid-${reference.pid.toString(16).padStart(4, "0")}-${safeAssetLanguage(reference.language)}-${String(index + 1).padStart(3, "0")}.sup`);
      const uniqueTracks = [...new Map(tracks.map((track) => [track.path, track])).values()];
      const trackRecords = [];
      for (const track of uniqueTracks) { const info = await lstat(resolve(transaction.stagingPath, track.path)); trackRecords.push({ clipId: track.clipId, pid: track.pid, language: track.language, streamNumber: track.streamNumber, displaySetCount: track.displaySets.length, byteLength: info.size }); await unlink(resolve(transaction.stagingPath, track.path)); }
      await mkdir(resolve(transaction.stagingPath, "sup"), { recursive: true });
      await writeFile(resolve(transaction.stagingPath, "sup/tracks.json"), `${JSON.stringify({ schemaVersion: "1.0", tracks: trackRecords }, null, 2)}\n`, { flag: "wx" });
      generatedFiles.push(await generatedFileRecord(transaction.stagingPath, "sup/tracks.json", "sup-track-index"));
    }
    const manifest = { schemaVersion: "1.0", stageStatus: outcome.status, analysisStage: "structural", selectedTypes: [includeHdmv ? "hdmv" : null, includeIgs ? "igs" : null, includeSup ? "sup" : null].filter(Boolean), igs: { status: igs.status, support: igs.support }, files: generatedFiles, limitations: ["IGS animation and visual effects are not fully verified", "dynamic MovieObject command targets are unresolved", "BD-J execution is unsupported"] };
    await writeFile(resolve(transaction.stagingPath, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    await transaction.commit();
    process.stdout.write(`${JSON.stringify({ stageStatus: outcome.status, output: roots.output })}\n`);
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
  } catch (error) { await transaction.abort(); throw error; }
}

async function generatedFileRecord(root: string, path: string, kind: string): Promise<{ path: string; kind: string; byteLength: string }> {
  const result = await stat(resolve(root, path));
  return { path, kind, byteLength: String(result.size) };
}

function mapIgsSource(source: { clipId: string; pid: number; packetOffset: string; pesOffset: string; segmentOffset: string; segmentFileOffset: string; pts90k: string | null; timeDomain: number }): Record<string, string | number | null> {
  return { path: `BDMV/STREAM/${source.clipId}.m2ts`, pid: source.pid, packetOffset: source.packetOffset, pesOffset: source.pesOffset, segmentOffset: source.segmentOffset, byteOffset: source.segmentFileOffset, pts90k: source.pts90k, timeDomain: source.timeDomain };
}

function serializeIgsScene(scene: Awaited<ReturnType<typeof extractIgsScenes>>["scenes"][number]): Record<string, unknown> {
  return {
    id: scene.id, clipId: scene.clipId, pid: scene.pid, compositionNumber: scene.compositionNumber,
    compositionState: scene.compositionState, width: scene.width, height: scene.height, timeDomain: scene.timeDomain,
    pts90k: scene.pts90k, streamModel: scene.streamModel, uiModel: scene.uiModel,
    compositionTimeout90k: scene.compositionTimeout90k, selectionTimeout90k: scene.selectionTimeout90k,
    userTimeoutDuration: scene.userTimeoutDuration, rawIcs: Array.from(scene.rawIcs), complete: scene.complete,
    source: mapIgsSource(scene.source),
    pages: scene.pages.map((page) => ({ ...page, uoMask: page.uoMask.toString(10), rawEffects: { ...page.rawEffects, enter: Array.from(page.rawEffects.enter), exit: Array.from(page.rawEffects.exit) }, buttons: page.buttons.map((button) => ({ ...button, commands: button.commands.map((command) => ({ ...command, bytes: Array.from(command.bytes) })) })) })),
    objects: scene.objects.map((object) => ({ ...object, indices: Array.from(object.indices), source: mapIgsSource(object.source) })),
    palettes: scene.palettes.map((palette) => ({ id: palette.id, version: palette.version, entries: [...palette.entries].map(([id, entry]) => ({ id, ...entry })), source: mapIgsSource(palette.source) })),
  };
}

function safeDiagnosticMessage(message: string, sourceRoot: string): string {
  return message.split(sourceRoot).join("<source>").replace(/\bBDMV\/[^\s,;:)]+/gi, "<source-file>");
}

function referencedAssetIds(value: unknown): Set<string> {
  const ids = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (typeof node !== "object" || node === null) return;
    for (const [key, item] of Object.entries(node)) {
      if (key === "assetId" && typeof item === "string") ids.add(item);
      else visit(item);
    }
  };
  visit(value);
  return ids;
}

function menuIgsSceneTargets(disc: ParsedDisc, playlist: ParsedDisc["playlists"][number]): Array<{ clipId: string; pid: number }> {
  const targets: Array<{ clipId: string; pid: number }> = [];
  for (const item of playlist.playItems) {
    const hasExplicitPrimaryIg = item.streams.some((stream) => stream.codingType === 0x91 && stream.streamType === 1 && stream.pid !== null);
    for (const stream of item.streams) {
      if (stream.codingType !== 0x91 || stream.pid === null) continue;
      if (stream.streamType === 1) {
        targets.push({ clipId: item.clipId, pid: stream.pid });
      } else if (stream.streamType === 2 && stream.subPathId !== null && stream.subClipId !== null) {
        const clip = playlist.subPaths[stream.subPathId]?.items[stream.subClipId];
        if (clip) targets.push({ clipId: clip.clipId, pid: stream.pid });
      }
    }
    // extractIgsScenes also accepts CLPI cues for primary clips when MPLS has no
    // explicit IG stream. Keep that proven playlist-to-clip association here,
    // while letting an explicit MPLS PID take precedence for the same clip.
    if (!hasExplicitPrimaryIg) {
      const clipInfo = disc.clips.find((clip) => clip.id.toLocaleLowerCase("en-US") === item.clipId.toLocaleLowerCase("en-US"));
      for (const stream of clipInfo?.programs.flatMap((program) => program.streams) ?? []) {
        if (stream.codingType === 0x91 && stream.pid !== null) targets.push({ clipId: item.clipId, pid: stream.pid });
      }
    }
  }
  return [...new Map(targets.map((target) => [`${target.clipId.toLocaleLowerCase("en-US")}\0${target.pid}`, target])).values()];
}

function findMenuScene(disc: ParsedDisc, playlist: ParsedDisc["playlists"][number], scenes: Awaited<ReturnType<typeof extractIgsScenes>>["scenes"]) {
  const targets = menuIgsSceneTargets(disc, playlist);
  const matches = scenes.filter((scene) => targets.some((target) => target.clipId.toLocaleLowerCase("en-US") === scene.clipId.toLocaleLowerCase("en-US") && target.pid === scene.pid));
  const unique = [...new Map(matches.map((scene) => [`${scene.clipId.toLocaleLowerCase("en-US")}\0${scene.pid}\0${scene.source.segmentFileOffset}`, scene])).values()];
  if (unique.length === 1) return { status: "found" as const, scene: unique[0]! };
  if (unique.length === 0) return { status: "not-found" as const };
  return { status: "ambiguous" as const, scenes: unique };
}

function createMenuDiscIR(disc: ParsedDisc, sceneRecords: Array<{ id: string; clipId: string }>, exportsMenuMedia: boolean): DiscIR {
  const diagnostics: DiscIR["diagnostics"] = disc.diagnostics.map((item) => ({
    severity: item.severity === "fatal" ? "fatal" : item.severity === "error" ? "error" : item.severity === "warning" ? "warning" : "info",
    code: item.code, message: safeDiagnosticMessage(item.message, disc.root), sourcePath: null, offset: null,
    entityId: null, action: null, recoverable: item.recoverable, stage: "structural", affectedEntryIds: [],
  }));
  const entries: DiscIR["entries"] = [];
  for (const entry of disc.entries) {
    const source = { path: "source/structural", origin: "primary" as const, byteOffset: "0" };
    if (entry.target.objectType === "HDMV" && typeof entry.target.target === "number") entries.push({ id: entry.id, navigation: { type: "HDMV", movieObjectId: entry.target.target }, source });
    else if (entry.target.objectType === "BDJ" && typeof entry.target.target === "string") entries.push({ id: entry.id, navigation: { type: "BDJ", bdjoId: entry.target.target, status: "unsupported" }, source });
    else diagnostics.push({ severity: "warning", code: "M4_ENTRY_NOT_PROJECTED", message: `Entry ${entry.id} has no supported navigation target and was omitted.`, sourcePath: null, offset: null, entityId: null, action: null, recoverable: true, stage: "structural", affectedEntryIds: [] });
  }
  if (!exportsMenuMedia) diagnostics.push({ severity: "warning", code: "M4_MEDIA_METADATA_NOT_PROJECTED", message: "Source video stream and playback metadata are not exported in the menu-only preview.", sourcePath: null, offset: null, entityId: null, action: null, recoverable: true, stage: "structural", affectedEntryIds: [] });
  const programs = disc.playlists.map((playlist, index) => ({ id: `program-${index}`, title: `Playlist ${playlist.id}` }));
  const menus = sceneRecords.map((_, index) => ({ id: `menu-${index}` }));
  const playlists: DiscIR["playlists"] = disc.playlists.map((playlist, index) => {
    const clipIds = new Set([
      ...playlist.playItems.map((item) => item.clipId),
      ...playlist.subPaths.flatMap((subPath) => subPath.items.map((item) => item.clipId)),
    ].map((clipId) => clipId.toLocaleLowerCase("en-US")));
    return { id: `playlist-${index}`, programIds: [`program-${index}`], menuIds: sceneRecords.flatMap((scene, sceneIndex) => clipIds.has(scene.clipId.toLocaleLowerCase("en-US")) ? [`menu-${sceneIndex}`] : []) };
  });
  return parseDiscIR({ schemaVersion: "1.0", entries, programs, menus, playlists, mediaAssets: [], diagnostics });
}

function findTopMenuPlaylist(disc: ParsedDisc, profile: PlayerProfile): ParsedDisc["playlists"][number] | undefined {
  const firstPlay = disc.entries.find((entry) => entry.kind === "firstPlay" && entry.target.objectType === "HDMV");
  const topMenu = disc.entries.find((entry) => entry.kind === "topMenu" && entry.target.objectType === "HDMV");
  if (typeof firstPlay?.target.target !== "number" || typeof topMenu?.target.target !== "number") return undefined;
  const vm = new HdmvVm(disc.movieObjects, { entries: disc.entries, profile });
  // First Play may initialize PSRs/GPRs before it jumps to a feature title.
  // Run that initialization, then enter the explicit index.bdmv Top Menu entry
  // via selectTitle(0). The playlist emitted there is the menu playlist; do not
  // infer menu identity from playlist repetition, duration, or filename.
  vm.reset(firstPlay.target.target);
  const startup = vm.runTurn();
  if (startup.waiting) vm.releaseExternalPlayback(startup.waiting);
  vm.drainActions();
  let navigation = vm.selectTitle(0);
  for (let step = 0; step < 16; step += 1) {
    if (navigation.waiting?.type === "PLAY_PLAYLIST") {
      return disc.playlists.find((item) => Number(item.id) === navigation.waiting!.payload.playlist);
    }
    const titleSearch = vm.drainActions().find((action) => action.type === "TITLE_SEARCH");
    if (!titleSearch || typeof titleSearch.payload.title !== "number") return undefined;
    navigation = vm.selectTitle(titleSearch.payload.title);
  }
  return undefined;
}

async function menuLoopMediaInput(disc: ParsedDisc, playlist: ParsedDisc["playlists"][number] | undefined): Promise<{ sourcePath: string; sourceFile: string; playlistId: string; playItemIndex: number; clipId: string; inTime45k: number; loopStart45k?: number; outTime45k: number; stillMode: number; repeatCount: number; loopBackground: boolean; videoPid: number; audioTracks: Array<{ streamNumber: number; pid: number; language: string }> } | null> {
  if (!playlist || playlist.playItems.length === 0) return null;
  const playItems = playlist.playItems;
  const first = playItems[0]!;
  const last = playItems.at(-1)!;
  if (playItems.some((item) => item.multiAngle)) return null;
  let repeatCount = 0;
  for (const item of [...playlist.playItems].reverse()) {
    if (item.clipId !== last.clipId || item.inTime45k !== last.inTime45k || item.outTime45k !== last.outTime45k || item.multiAngle) break;
    repeatCount++;
  }
  const repeatedTail = repeatCount >= 2;
  const tailStart = playItems.length - (repeatedTail ? repeatCount : 1);
  const timelineItems = repeatedTail ? [last] : playItems;
  const loopItem = repeatedTail ? last : first;
  // A Top Menu playlist is identified by the HDMV command chain above. Its
  // background topology is derived from the selected timeline: a complete
  // single item, adjacent intervals in the same source clip, an explicit loop
  // mark, or an identical repeated tail. Playlist repetition is not a menu test.
  const sameSourceContinuous = timelineItems.every((item, index) => item.clipId === first.clipId
    && (index === 0 || timelineItems[index - 1]!.outTime45k === item.inTime45k));
  const oneTimelineSpan = repeatedTail || sameSourceContinuous;
  if (!oneTimelineSpan || (repeatedTail && tailStart > 0)) return null;
  const spanStart = repeatedTail ? last.inTime45k : first.inTime45k;
  const spanEnd = last.outTime45k;
  const loopStart45k = (repeatedTail ? [last] : timelineItems)
    .map((item) => resolveMenuLoopStart45k(item.index, item.inTime45k, item.outTime45k, playlist.marks))
    .filter((time): time is number => time !== undefined)
    .at(-1);
  const streamDeclarationsMatch = playItems.every((item) => item.streams.length === first.streams.length
    && item.streams.every((stream, index) => {
      const initial = first.streams[index]!;
      return stream.pid === initial.pid && stream.codingType === initial.codingType && stream.streamType === initial.streamType && stream.language === initial.language;
    }));
  if (!streamDeclarationsMatch) return null;
  const video = first.streams.find((stream) => stream.pid !== null && (stream.codingType === 0x1b || stream.codingType === 0x24) && stream.streamType === 1);
  const audioCodingTypes = new Set([0x03, 0x04, 0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0xa1, 0xa2]);
  const audioStreams = first.streams.filter((stream) => stream.pid !== null && stream.streamType === 1 && stream.codingType !== null && audioCodingTypes.has(stream.codingType) && stream.language !== null);
  if (!video?.pid || audioStreams.length === 0 || audioStreams.some((stream) => !/^[A-Za-z]{3}$/.test(stream.language!))) return null;
  const sourceFile = `BDMV/STREAM/${first.clipId}.m2ts`;
  const sourcePath = await resolveInputFile(disc.root, `STREAM/${first.clipId}.m2ts`);
  return {
    sourcePath, sourceFile, playlistId: playlist.id, playItemIndex: repeatedTail ? last.index : first.index, clipId: first.clipId,
    inTime45k: spanStart, ...(loopStart45k !== undefined ? { loopStart45k } : {}), outTime45k: spanEnd, stillMode: loopItem.stillMode, repeatCount: Math.max(1, repeatCount), loopBackground: loopItem.stillMode !== 2 && (repeatedTail || loopStart45k !== undefined), videoPid: video.pid,
    audioTracks: audioStreams.map((stream, index) => ({ streamNumber: index, pid: stream.pid!, language: stream.language! })),
  };
}

async function convert(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "convert requires a BDMV input path");
  // Argument contract first: every option value is resolved before the input is parsed and
  // before any output transaction exists. A missing value must never be masked by disc
  // diagnostics, and a late failure must never leave a staging directory behind.
  if (lookupOption("--limits").found) {
    optionValue("--limits"); // A bare `--limits` is a missing value, not an unimplemented feature.
    fail("CLI_NOT_IMPLEMENTED", "--limits is not wired yet; it will apply once VmOptions.limits lands (batch 2, D3)");
  }
  const profile = await loadPlayerProfile(optionValue("--player-profile"));
  const outOption = optionValue("--out");
  const titleOption = optionValue("--title");
  const overwrite = argv.includes("--overwrite");
  const disc = await parseBdmv(input);
  const fatalDiagnostics = classifyDiagnostics(disc.diagnostics);
  if (fatalDiagnostics.hasFatal) {
    stageFailure(firstBlockingCode(fatalDiagnostics.blocking), fatalDiagnostics.blocking);
    return;
  }
  const out = outOption ?? resolve(dirname(disc.root), "BDMV-menu");
  const title = titleOption ?? basename(dirname(disc.root));
  const roots = await assertDisjointRoots(disc.root, resolve(out));
  const extraction = await extractIgsScenes(disc);
  const menuPlaylist = findTopMenuPlaylist(disc, profile);
  const menuMedia = await menuLoopMediaInput(disc, menuPlaylist);
  const transaction = await beginOutputTransaction(roots.output, { overwrite });
  try {
    const failMenuConversion = async (code: string, message: string): Promise<void> => {
      await writeFile(resolve(transaction.stagingPath, "README.md"), `# Menu-only preview\n\n${message}\n\nStatus: **failed**.\n`);
      // The failure report keeps the same shape as the success report so a consumer
      // can read one schema regardless of how the conversion ended (P2-P2-5).
      const diagnostics = deliveryDiagnostics([
        { code, message, severity: "error" },
        ...disc.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, roots.input), severity: item.severity })),
        ...extraction.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, roots.input), severity: item.severity })),
      ]);
      const report = { schemaVersion: "1.0", status: "failed", code, mode: "menu-only", auditScope: "convert", reasons: [message], notVerified: [], diagnostics, blockingDiagnostics: classifyDiagnostics(diagnostics).blocking };
      await writeFile(resolve(transaction.stagingPath, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      await transaction.commit();
      process.stdout.write(`${JSON.stringify({ status: "failed", code, output: roots.output })}\n`);
      process.exitCode = 1;
    };
    if (!extraction.scenes.length) {
      await failMenuConversion("MENU_SCENE_NOT_FOUND", "Conversion did not produce a runnable package because no IGS scene was found in the BDMV input.");
      return;
    }
    if (!menuPlaylist) {
      await failMenuConversion("MENU_PLAYLIST_NOT_RESOLVED", "The HDMV Top Menu playlist could not be resolved from the disc navigation entries; no IGS scene was selected.");
      return;
    }
    const menuSceneResult = findMenuScene(disc, menuPlaylist, extraction.scenes);
    if (menuSceneResult.status === "not-found") {
      await failMenuConversion("MENU_SCENE_NOT_FOUND", `No extracted IGS scene matches the stream and clip declarations in Top Menu playlist ${menuPlaylist.id}; no other scene was selected.`);
      return;
    }
    if (menuSceneResult.status === "ambiguous") {
      const sources = menuSceneResult.scenes.map((scene) => `${scene.id} (clip ${scene.clipId}, PID ${scene.pid} @ byte ${scene.source.segmentFileOffset})`);
      await failMenuConversion("MENU_SCENE_AMBIGUOUS", `Top Menu playlist ${menuPlaylist.id} maps to multiple extracted IGS scenes: ${sources.join(", ")}; no scene was selected.`);
      return;
    }
    const menuScene = menuSceneResult.scene;
    const adapted = adaptIgsScene(menuScene, extraction.assets);
    const scene = adapted.scene;
    const popupAdaptations = extraction.scenes.filter((candidate) => candidate.uiModel === 1).map((candidate) => adaptIgsScene(candidate, extraction.assets));
    const popupScenes = popupAdaptations.map((result) => result.scene);
    const vmPrograms = disc.movieObjects.map(({ id, instructions, resumeIntention, menuCallMask, titleSearchMask }) => ({
      id,
      instructions: instructions.map(({ words, bytes, source }) => ({ words, bytes, source: { path: "<MovieObject>", origin: source.origin, offset: source.offset } })),
      resumeIntention, menuCallMask, titleSearchMask,
    }));
    const menuEntry = disc.entries.find((entry) => entry.kind === "topMenu" && entry.target.objectType === "HDMV" && typeof entry.target.target === "number")
      ?? disc.entries.find((entry) => entry.kind === "firstPlay" && entry.target.objectType === "HDMV" && typeof entry.target.target === "number");
    const vmInitialProgramId = typeof menuEntry?.target.target === "number" ? menuEntry.target.target : undefined;
    const firstPlay = disc.entries.find((entry) => entry.kind === "firstPlay" && entry.target.objectType === "HDMV" && typeof entry.target.target === "number");
    const vmFirstPlayProgramId = typeof firstPlay?.target.target === "number" ? firstPlay.target.target : undefined;
    const referenced = referencedAssetIds([scene, ...popupScenes]);
    const graphics = extraction.assets.filter((asset) => referenced.has(asset.id)).map((asset) => ({ id: asset.id, bytes: asset.pngBytes }));
    const diagnostics: Array<{ code: string; message: string; severity?: string }> = [
      ...disc.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, roots.input), severity: item.severity })),
      ...extraction.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, roots.input), severity: item.severity })),
      ...adapted.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, roots.input), severity: item.severity })),
      ...popupAdaptations.flatMap((result) => result.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, roots.input), severity: item.severity }))),
    ];
    if (popupScenes.length) diagnostics.push({ code: "M4_POPUP_RENDER_PARTIAL", message: "Popup IGS compositions are overlaid when POPUP_MENU has an unambiguous match for the active packaged menu clip/PID. Title playback delegated to the external player cannot be overlaid.", severity: "warning" });
    if (!menuMedia) diagnostics.push({ code: "M5_MENU_LOOP_UNAVAILABLE", message: "The HDMV Top Menu command selected a playlist, but its background timeline could not be represented as one continuous source-clip span or a repeated tail with supported video and primary audio streams.", severity: "warning" });
    if (vmInitialProgramId === undefined || !vmPrograms.some((program) => program.id === vmInitialProgramId)) diagnostics.push({ code: "M4_MENU_OBJECT_CONTEXT_MISSING", message: "No valid HDMV Top Menu or First Play MovieObject is available for menu button commands.", severity: "warning" });
    let soundBytes: Uint8Array | null = null;
    const soundPath = disc.sounds[0]?.source.path;
    if (soundPath) {
      try {
        const relativeSoundPath = soundPath.replace(/^BDMV\//i, "");
        soundBytes = new Uint8Array(await readFile(await resolveInputFile(disc.root, relativeSoundPath)));
      } catch (error) {
        diagnostics.push({ code: "SOUND_SOURCE_MISSING", message: safeDiagnosticMessage(error instanceof Error ? error.message : String(error), roots.input) });
      }
    }
    const ir = createMenuDiscIR(disc, extraction.scenes.map(({ id, clipId }) => ({ id, clipId })), menuMedia !== null);
    // Delivery status is decided from facts that are all known before packaging, so
    // the package can record the same conclusion instead of inventing its own (D-2R).
    const decisionFacts = deliveryDiagnostics(diagnostics);
    const decision = decideDelivery({
      mode: "menu-only",
      checks: [],
      diagnostics: decisionFacts,
      declaredEntryCount: disc.entries.length,
      hdmvEntryCount: disc.entries.filter((entry) => entry.target.objectType === "HDMV").length,
      // `buildMenuPackage` reached this point, so no required asset can be missing.
      hasMissingRequiredAsset: false,
      limitations: menuMedia ? [] : ["Menu loop media is unavailable; the menu background holds its final frame."],
    }, strictDefault());
    const blockingDiagnostics = classifyDiagnostics(decisionFacts).blocking;
    await buildMenuPackage({
      outputDirectory: transaction.stagingPath, title, ir, status: decision.status,
      entryCounts: { declared: disc.entries.length, hdmv: disc.entries.filter((entry) => entry.target.objectType === "HDMV").length },
      scene, popupScenes, vmPrograms, vmEntries: disc.entries,
      externalTargets: buildExternalTargets(disc, extraction.scenes),
      bdmvPath: dirname(roots.input) === dirname(roots.output) ? relative(roots.output, disc.root) : disc.root,
      ...(vmInitialProgramId === undefined ? {} : { vmInitialProgramId }),
      ...(vmFirstPlayProgramId === undefined ? {} : { vmFirstPlayProgramId }),
      graphics, soundEntries: disc.sounds, soundBytes, playerProfile: profile,
      ...(overwrite ? { reuseMediaFromDirectory: roots.output } : {}),
      ...(menuMedia ? { menuLoopMedia: menuMedia } : {}),
      diagnostics: diagnostics.map(({ code, message, severity }) => ({ code, message, ...(severity === undefined ? {} : { severity }) })),
    });
    const report = { schemaVersion: "1.0", status: decision.status, mode: "menu-only", auditScope: "convert", reasons: decision.reasons, notVerified: decision.notVerified, diagnostics: decisionFacts, blockingDiagnostics };
    await writeFile(resolve(transaction.stagingPath, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    await transaction.commit();
    process.stdout.write(`${JSON.stringify({ status: decision.status, mode: "menu-only", output: roots.output })}\n`);
    if (decision.exitCode !== 0) process.exitCode = decision.exitCode;
  } catch (error) { await transaction.abort(); throw error; }
}

async function validate(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "validate requires an output package directory");
  if (!argv.includes("--offline")) fail("CLI_OFFLINE_REQUIRED", "validate currently requires --offline");
  // Argument contract first: a rejected command must not rewrite the package (P2-P2-1).
  const format = optionValue("--format");
  if (format !== undefined && format !== "json") fail("CLI_INVALID_FORMAT", `validate supports only 'json' for --format, got '${format}'`);
  const strict = strictDefault();
  const audit = await auditOutputPackage(resolve(input));
  const writable = !audit.checks.some((check) => check.checkId === "PACKAGE_ROOT_MISSING" || check.checkId === "PACKAGE_ROOT_INVALID");
  const manifest = await readJsonObject(resolve(audit.packageRoot, audit.manifestPath));
  const previousCompatibility = await readJsonObject(resolve(audit.packageRoot, "compatibility.json"));
  const reportedReport = await readJsonObject(resolve(audit.packageRoot, "report.json"));
  // A failed conversion only writes README.md and report.json. That report still
  // declares the intended shape, so it is the fallback source for `mode`; its
  // `status` is never trusted (D-13).
  const manifestMode = packageMode(manifest.mode);
  const reportMode = packageMode(reportedReport.mode);
  const modeSource = manifestMode !== undefined ? "manifest" as const : reportMode !== undefined ? "report" as const : "assumed" as const;
  const mode = manifestMode ?? reportMode ?? "standalone-full";
  if (modeSource === "assumed") audit.checks.push({ checkId: "PACKAGE_MODE_ASSUMED", result: "not-verified", message: "Neither manifest.json nor report.json declares a supported mode; 'standalone-full' was assumed.", path: "manifest.json" });
  const limitations = Array.isArray(manifest.limitations) ? manifest.limitations.filter((item): item is string => typeof item === "string") : [];
  // A package records the diagnostics that decided its own conversion. Re-reading
  // them keeps convert and validate on the same evidence instead of two verdicts.
  const manifestDiagnostics: DeliveryDiagnostic[] = (Array.isArray(manifest.diagnostics) ? manifest.diagnostics : [])
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
    .map((item) => ({
      severity: typeof item.severity === "string" ? item.severity : "warning",
      ...(typeof item.code === "string" ? { code: item.code } : {}),
      ...(typeof item.message === "string" ? { message: item.message } : {}),
    }));
  const declaredEntryCount = Number.isSafeInteger(manifest.declaredEntryCount) && (manifest.declaredEntryCount as number) >= 0 ? manifest.declaredEntryCount as number : undefined;
  const hdmvEntryCount = Number.isSafeInteger(manifest.hdmvEntryCount) && (manifest.hdmvEntryCount as number) >= 0 ? manifest.hdmvEntryCount as number : undefined;
  const coverage = summarizeDeliveryCoverage({
    entries: { reason: "Per-entry coverage evidence is not present in this package." },
    instructions: { reason: "Per-instruction coverage evidence is not present in this package." },
    media: { reason: "Per-media coverage evidence is not present in this package." },
    tests: { reason: "V1 browser and test-matrix evidence is not present in this package." },
  });
  const releaseSummaryInput = {
    audit,
    mode,
    modeSource,
    dependencyAudit: createDependencyAuditReport(audit),
    coverage,
    browserEvidence: [],
    referenceEvidence: [],
    decisionFacts: {
      limitations,
      diagnostics: manifestDiagnostics,
      ...(declaredEntryCount === undefined ? {} : { declaredEntryCount }),
      ...(hdmvEntryCount === undefined ? {} : { hdmvEntryCount }),
      hasMissingRequiredAsset: audit.checks.some((check) => check.checkId === "PACKAGE_MISSING_ASSET" || check.checkId === "PACKAGE_REQUIRED_ASSET_MISSING"),
      ...(typeof manifest.hasUnresolvedReachability === "boolean" ? { hasUnresolvedReachability: manifest.hasUnresolvedReachability } : {}),
      ...(typeof manifest.hasUnsupportedReachableCapability === "boolean" ? { hasUnsupportedReachableCapability: manifest.hasUnsupportedReachableCapability } : {}),
    },
    strict,
  } as const;
  let releaseSummary = createReleaseSummary(releaseSummaryInput);
  // `validate` never rewrites manifest.status: a disagreement is reported as
  // unverified evidence, not repaired behind the caller's back (D-2R).
  const manifestStatus = typeof manifest.status === "string" ? manifest.status : undefined;
  if (manifestStatus !== undefined && manifestStatus !== releaseSummary.release.status) {
    audit.checks.push({ checkId: "MANIFEST_STATUS_UNVERIFIED", result: "not-verified", message: `manifest.json records status '${manifestStatus}' but the current evidence decides '${releaseSummary.release.status}'; the manifest is not rewritten.`, path: "manifest.json" });
    releaseSummary = createReleaseSummary(releaseSummaryInput);
  }
  const priorNotVerified = Array.isArray(previousCompatibility.notVerified) ? previousCompatibility.notVerified.filter((item): item is string => typeof item === "string") : [];
  const currentGaps = releaseSummary.release.gaps.map((gap) => gap.checkId);
  releaseSummary = {
    ...releaseSummary,
    compatibility: {
      ...releaseSummary.compatibility,
      ...(typeof previousCompatibility.profile === "string" ? { profile: previousCompatibility.profile } : {}),
      browserEvidence: [],
      externalDependencies: Array.isArray(previousCompatibility.externalDependencies) ? previousCompatibility.externalDependencies : [],
      notVerified: [...new Set([...priorNotVerified, ...currentGaps])],
    },
  };
  let dependencyAudit = releaseSummary.dependencyAudit;
  if (writable) {
    try {
      // Every on-disk report must come from the same summary, so the dependency
      // audit is written after the summary exists instead of from a pre-summary
      // intermediate value (D-12).
      await writeGeneratedReport(audit.packageRoot, "dependency-audit.json", `${JSON.stringify(releaseSummary.dependencyAudit, null, 2)}\n`);
      await writeGeneratedReport(audit.packageRoot, "compatibility.json", `${JSON.stringify(releaseSummary.compatibility, null, 2)}\n`);
      await writeGeneratedReport(audit.packageRoot, "reports/release-summary.json", `${JSON.stringify(releaseSummary, null, 2)}\n`);
    } catch (error) {
      audit.checks.push({ checkId: "RELEASE_REPORT_WRITE_FAILED", result: "fail", message: error instanceof Error ? error.message : String(error), path: "reports/release-summary.json" });
      releaseSummary = createReleaseSummary(releaseSummaryInput);
      dependencyAudit = releaseSummary.dependencyAudit;
    }
  }
  const decision = releaseSummary.release;
  if (format === "json") process.stdout.write(`${JSON.stringify({ ...audit, dependencyAudit, ...(manifestStatus === undefined ? {} : { manifestStatus }), decision, releaseSummary })}\n`);
  else {
    const failed = audit.checks.filter((check) => check.result === "fail");
    const unverified = audit.checks.filter((check) => check.result === "not-verified");
    process.stdout.write(`Offline package audit: ${failed.length ? "failed" : unverified.length ? "not verified" : "passed"}\n`);
    process.stdout.write(`Dependency audit: ${dependencyAudit.status}\n`);
    process.stdout.write(`Delivery decision: ${decision.status}${decision.strict ? " (strict)" : ""}\n`);
    if (manifestStatus !== undefined && manifestStatus !== decision.status) process.stdout.write(`Manifest status: ${manifestStatus} (not rewritten)\n`);
    for (const check of audit.checks) if (check.result !== "pass") process.stdout.write(`${check.result.toUpperCase()} ${check.checkId}${check.path ? ` ${check.path}` : ""}: ${check.message}\n`);
    for (const gap of releaseSummary.release.gaps) process.stdout.write(`GAP ${gap.result} ${gap.checkId}${gap.path ? ` ${gap.path}` : ""}: ${gap.message} Next: ${gap.action}\n`);
    for (const reason of decision.reasons) process.stdout.write(`DECISION ${reason}\n`);
  }
  process.exitCode = decision.exitCode;
}

/** Read a JSON object, treating anything else as absent. */
async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function packageMode(value: unknown): "menu-only" | "standalone-full" | undefined {
  return value === "menu-only" || value === "standalone-full" ? value : undefined;
}

async function writeGeneratedReport(root: string, relativePath: string, content: string): Promise<void> {
  const reportPath = resolve(root, relativePath);
  const parentPath = dirname(reportPath);
  try {
    const parent = await lstat(parentPath);
    if (parent.isSymbolicLink() || !parent.isDirectory()) throw new Error(`Report directory is not a regular directory: ${relativePath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(parentPath, { recursive: true });
  }
  try {
    const existing = await lstat(reportPath);
    if (existing.isSymbolicLink() || !existing.isFile()) throw new Error(`Report target is not a regular file: ${relativePath}`);
    await writeFile(reportPath, content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(reportPath, content, { flag: "wx" });
  }
}

async function main(): Promise<void> {
  if (!command || !supported.has(command)) fail("CLI_USAGE", "Usage: bdmv2web <inspect|extract|convert|validate|compare|list-assets|export-assets> [INPUT] [options]");
  validateCommandLine();
  if (command === "inspect") return inspect();
  if (command === "extract") return extract();
  if (command === "convert") return convert();
  if (command === "validate") return validate();
  if (command === "list-assets") return listAssets();
  if (command === "export-assets") return exportAssets();
  const mode = optionValue("--mode") ?? "standalone-full"; const strict = strictDefault(); const format = optionValue("--format");
  const detail = { code: "E_NOT_IMPLEMENTED", command, mode, strict, message: `The '${command}' command is not implemented yet.` };
  process.stderr.write(format === "json" ? `${JSON.stringify(detail)}\n` : `${detail.code}: ${detail.message}\n`);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  const e = error instanceof Error ? error : new Error(String(error));
  const code = error instanceof ContractError ? error.code : "E_IO";
  const record = { code, message: e.message, path: error instanceof ContractError ? error.path : null };
  process.stderr.write(rawOptionValue("--format") === "json" ? `${JSON.stringify(record)}\n` : `${code}: ${e.message}\n`);
  process.exitCode = 1;
});
