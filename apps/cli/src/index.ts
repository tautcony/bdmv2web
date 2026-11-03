#!/usr/bin/env node
import { link, lstat, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { assertDisjointRoots, beginOutputTransaction, hashFile, resolveInputFile } from "@bdmv-web/bdmv-io";
import { ContractError, parseDiscIR, type DiscIR } from "@bdmv-web/core";
import { parseBdmv, type ParsedDisc } from "@bdmv-web/bdmv-parser";
import { extractIgsScenes } from "@bdmv-web/igs";
import { buildMenuPackage } from "@bdmv-web/package-builder";
import { adaptIgsScene } from "@bdmv-web/runtime-web";
import { auditOutputPackage, createDependencyAuditReport, createReleaseSummary, summarizeDeliveryCoverage } from "@bdmv-web/test-runner";

const argv = process.argv.slice(2);
const command = argv[0];
const supported = new Set(["inspect", "extract", "convert", "validate", "compare"]);
function optionValue(name: string): string | undefined {
  const index = argv.findIndex((value) => value === name || value.startsWith(`${name}=`));
  if (index < 0) return undefined;
  const arg = argv[index]!;
  return arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[index + 1];
}
function strictDefault(): boolean {
  if (argv.includes("--strict")) return true;
  if (argv.includes("--no-strict")) return false;
  return command === "convert" && optionValue("--mode") !== "menu-only";
}
function inputPath(): string | undefined {
  const takesValue = new Set(["--format", "--out", "--mode", "--player-profile", "--limits", "--title"]);
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

async function inspect(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "inspect requires an input path");
  const disc = await parseBdmv(input);
  const json = `${JSON.stringify(disc, null, 2)}\n`;
  const out = optionValue("--out");
  if (!out) { process.stdout.write(json); return; }
  const target = resolve(out); await assertDisjointRoots(disc.root, target);
  const temp = resolve(dirname(target), `.${basename(target)}.tmp-${process.pid}`);
  try { await writeFile(temp, json, { flag: "wx" }); await link(temp, target); await unlink(temp); }
  catch (error) { await rm(temp, { force: true }); throw error; }
}

async function extract(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "extract requires an input path");
  const out = optionValue("--out"); if (!out) fail("CLI_MISSING_OUTPUT", "extract requires --out DIR");
  const disc = await parseBdmv(input);
  const roots = await assertDisjointRoots(disc.root, resolve(out));
  const transaction = await beginOutputTransaction(roots.output);
  try {
    const igs = await extractIgsScenes(disc);
    const commandTable = disc.movieObjects.flatMap((object) => object.instructions.map((instruction, instructionIndex) => ({ movieObjectId: object.id, instructionIndex, words: instruction.words, bytes: instruction.bytes, source: instruction.source })));
    const raw = `${JSON.stringify(commandTable, null, 2)}\n`;
    const rawPath = resolve(transaction.stagingPath, "raw-commands.json");
    await writeFile(rawPath, raw, { flag: "wx" });
    const sceneRecords = igs.scenes.map((scene) => {
      const adapted = adaptIgsScene(scene, igs.assets.filter((asset) => asset.id.startsWith(`igs-${scene.clipId}-${scene.pid}-${scene.compositionNumber}-`)));
      return { id: scene.id, status: adapted.status, scene: adapted.scene, raw: serializeIgsScene(scene), diagnostics: adapted.diagnostics };
    });
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
    await writeFile(resolve(transaction.stagingPath, "parsed-disc.json"), `${JSON.stringify(disc, null, 2)}\n`, { flag: "wx" });
    await writeFile(resolve(transaction.stagingPath, "scenes.json"), sceneJson, { flag: "wx" });
    await writeFile(resolve(transaction.stagingPath, "igs-diagnostics.json"), diagnosticsJson, { flag: "wx" });
    await writeFile(resolve(transaction.stagingPath, "source-map.json"), sourceMapJson, { flag: "wx" });
    const generatedFiles = [
      await generatedFileRecord(transaction.stagingPath, "parsed-disc.json", "parsed-disc"),
      await generatedFileRecord(transaction.stagingPath, "raw-commands.json", "raw-command-table"),
      await generatedFileRecord(transaction.stagingPath, "scenes.json", "igs-scenes"),
      await generatedFileRecord(transaction.stagingPath, "igs-diagnostics.json", "igs-diagnostics"),
      await generatedFileRecord(transaction.stagingPath, "source-map.json", "source-map"),
    ];
    for (const asset of igs.assets) {
      const relativePath = asset.relativePath.replaceAll("\\", "/");
      if (!relativePath.startsWith("assets/graphics/") || relativePath.split("/").includes("..")) throw new Error(`Invalid generated IGS asset path: ${asset.relativePath}`);
      const assetPath = resolve(transaction.stagingPath, relativePath);
      await mkdir(dirname(assetPath), { recursive: true });
      await writeFile(assetPath, asset.pngBytes, { flag: "wx" });
      generatedFiles.push(await generatedFileRecord(transaction.stagingPath, relativePath, "image"));
    }
    const manifest = { schemaVersion: "1.0", status: "partial", analysisStage: "structural", igs: { status: igs.status, support: igs.support }, files: generatedFiles, limitations: ["IGS color conversion and complete visual fidelity remain unverified", "dynamic MovieObject command targets are unresolved", "BD-J execution is unsupported"] };
    await writeFile(resolve(transaction.stagingPath, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    await transaction.commit();
    process.stdout.write(`${JSON.stringify({ status: "partial", output: roots.output })}\n`);
  } catch (error) { await transaction.abort(); throw error; }
}

async function generatedFileRecord(root: string, path: string, kind: string): Promise<{ path: string; kind: string; sha256: string; byteLength: string }> {
  const result = await hashFile(resolve(root, path));
  return { path, kind, sha256: result.sha256, byteLength: result.byteLength.toString() };
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

async function menuLoopMediaInput(disc: ParsedDisc): Promise<{ sourcePath: string; sourceFile: string; playlistId: string; playItemIndex: number; clipId: string; inTime45k: number; outTime45k: number; repeatCount: number; videoPid: number; audioTracks: Array<{ streamNumber: number; pid: number; language: string }> } | null> {
  const playlist = disc.playlists.find((item) => item.id === "00003");
  const first = playlist?.playItems[0];
  if (!playlist || !first || playlist.playItems.some((item) => item.clipId !== first.clipId || item.inTime45k !== first.inTime45k || item.outTime45k !== first.outTime45k || item.multiAngle)) return null;
  const video = first.streams.find((stream) => stream.pid !== null && stream.codingType === 0x1b && stream.streamType === 1);
  const audioCodingTypes = new Set([0x03, 0x04, 0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0xa1, 0xa2]);
  const audioStreams = first.streams.filter((stream) => stream.pid !== null && stream.streamType === 1 && stream.codingType !== null && audioCodingTypes.has(stream.codingType) && stream.language !== null);
  if (!video?.pid || audioStreams.length === 0 || audioStreams.some((stream) => !/^[A-Za-z]{3}$/.test(stream.language!))) return null;
  const sourceFile = `BDMV/STREAM/${first.clipId}.m2ts`;
  const sourcePath = await resolveInputFile(disc.root, `STREAM/${first.clipId}.m2ts`);
  return {
    sourcePath, sourceFile, playlistId: playlist.id, playItemIndex: first.index, clipId: first.clipId,
    inTime45k: first.inTime45k, outTime45k: first.outTime45k, repeatCount: playlist.playItems.length, videoPid: video.pid,
    audioTracks: audioStreams.map((stream, index) => ({ streamNumber: index, pid: stream.pid!, language: stream.language! })),
  };
}

async function convert(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "convert requires a BDMV input path");
  const mode = optionValue("--mode") ?? "standalone-full";
  if (mode !== "menu-only") fail("CLI_UNSUPPORTED_MODE", "convert currently supports only --mode menu-only");
  const out = optionValue("--out"); if (!out) fail("CLI_MISSING_OUTPUT", "convert --mode menu-only requires --out DIR");

  const disc = await parseBdmv(input);
  const roots = await assertDisjointRoots(disc.root, resolve(out));
  const extraction = await extractIgsScenes(disc);
  const menuMedia = await menuLoopMediaInput(disc);
  const transaction = await beginOutputTransaction(roots.output);
  if (!extraction.scenes.length) {
    try {
      await writeFile(resolve(transaction.stagingPath, "README.md"), "# Menu-only preview\n\nConversion did not produce a runnable package because no complete IGS menu scene was found.\n\nStatus: **failed**.\n");
      const diagnostics = [
        { code: "MENU_SCENE_NOT_FOUND", message: "No complete IGS menu scene was found in the BDMV input." },
        ...disc.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, roots.input) })),
        ...extraction.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, roots.input) })),
      ];
      await writeFile(resolve(transaction.stagingPath, "report.json"), `${JSON.stringify({ schemaVersion: "1.0", status: "failed", code: "MENU_SCENE_NOT_FOUND", mode: "menu-only", diagnostics }, null, 2)}\n`);
      await transaction.commit();
      process.stdout.write(`${JSON.stringify({ status: "failed", code: "MENU_SCENE_NOT_FOUND", output: roots.output })}\n`);
      process.exitCode = 1;
      return;
    } catch (error) { await transaction.abort(); throw error; }
  }

  const adapted = adaptIgsScene(extraction.scenes[0]!, extraction.assets);
  const scene = adapted.scene;
  const vmPrograms = disc.movieObjects.map(({ id, instructions, resumeIntention, menuCallMask, titleSearchMask }) => ({
    id,
    instructions: instructions.map(({ words, bytes, source }) => ({ words, bytes, source: { path: "<MovieObject>", origin: source.origin, offset: source.offset } })),
    resumeIntention, menuCallMask, titleSearchMask,
  }));
  const menuEntry = disc.entries.find((entry) => entry.kind === "topMenu" && entry.target.objectType === "HDMV" && typeof entry.target.target === "number")
    ?? disc.entries.find((entry) => entry.kind === "firstPlay" && entry.target.objectType === "HDMV" && typeof entry.target.target === "number");
  const vmInitialProgramId = typeof menuEntry?.target.target === "number" ? menuEntry.target.target : undefined;
  const referenced = referencedAssetIds(scene);
  const graphics = extraction.assets.filter((asset) => referenced.has(asset.id)).map((asset) => ({ id: asset.id, bytes: asset.pngBytes }));
  const title = optionValue("--title") ?? basename(dirname(disc.root));
  const diagnostics = [
    ...disc.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, roots.input) })),
    ...extraction.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, roots.input) })),
    ...adapted.diagnostics.map((item) => ({ code: item.code, message: safeDiagnosticMessage(item.message, roots.input) })),
  ];
  if (!menuMedia) diagnostics.push({ code: "M5_MENU_LOOP_UNAVAILABLE", message: "Playlist 00003 does not declare a single repeated clip loop with supported video and primary-audio streams." });
  if (vmInitialProgramId === undefined || !vmPrograms.some((program) => program.id === vmInitialProgramId)) diagnostics.push({ code: "M4_MENU_OBJECT_CONTEXT_MISSING", message: "No valid HDMV Top Menu or First Play MovieObject is available for menu button commands." });
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
  try {
    const ir = createMenuDiscIR(disc, extraction.scenes.map(({ id, clipId }) => ({ id, clipId })), menuMedia !== null);
    await buildMenuPackage({ outputDirectory: transaction.stagingPath, title, ir, scene, vmPrograms, ...(vmInitialProgramId === undefined ? {} : { vmInitialProgramId }), graphics, soundEntries: disc.sounds, soundBytes, ...(menuMedia ? { menuLoopMedia: menuMedia } : {}), diagnostics });
    await transaction.commit();
    process.stdout.write(`${JSON.stringify({ status: "partial", mode: "menu-only", output: roots.output })}\n`);
    if (strictDefault()) process.exitCode = 2;
  } catch (error) { await transaction.abort(); throw error; }
}

async function validate(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "validate requires an output package directory");
  if (!argv.includes("--offline")) fail("CLI_OFFLINE_REQUIRED", "validate currently requires --offline");
  const audit = await auditOutputPackage(resolve(input));
  let dependencyAudit = createDependencyAuditReport(audit);
  if (!audit.checks.some((check) => check.checkId === "PACKAGE_ROOT_MISSING" || check.checkId === "PACKAGE_ROOT_INVALID")) {
    try {
      await writeGeneratedReport(audit.packageRoot, "dependency-audit.json", `${JSON.stringify(dependencyAudit, null, 2)}\n`);
    } catch (error) {
      audit.checks.push({ checkId: "DEPENDENCY_AUDIT_WRITE_FAILED", result: "fail", message: error instanceof Error ? error.message : String(error), path: "dependency-audit.json" });
    }
  }
  let manifest: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(resolve(audit.packageRoot, audit.manifestPath), "utf8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) manifest = parsed as Record<string, unknown>;
  } catch { /* The package audit already reports missing or invalid manifest data. */ }
  let previousCompatibility: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(resolve(audit.packageRoot, "compatibility.json"), "utf8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) previousCompatibility = parsed as Record<string, unknown>;
  } catch { /* A missing or malformed prior report is replaced by the fresh summary. */ }
  const mode = manifest.mode === "menu-only" ? "menu-only" : "standalone-full";
  const limitations = Array.isArray(manifest.limitations) ? manifest.limitations.filter((item): item is string => typeof item === "string") : [];
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
    dependencyAudit,
    coverage,
    browserEvidence: [],
    referenceEvidence: [],
    decisionFacts: {
      limitations,
      ...(declaredEntryCount === undefined ? {} : { declaredEntryCount }),
      ...(hdmvEntryCount === undefined ? {} : { hdmvEntryCount }),
      hasMissingRequiredAsset: audit.checks.some((check) => check.checkId === "PACKAGE_MISSING_ASSET" || check.checkId === "PACKAGE_REQUIRED_ASSET_MISSING"),
      ...(typeof manifest.hasUnresolvedReachability === "boolean" ? { hasUnresolvedReachability: manifest.hasUnresolvedReachability } : {}),
      ...(typeof manifest.hasUnsupportedReachableCapability === "boolean" ? { hasUnsupportedReachableCapability: manifest.hasUnsupportedReachableCapability } : {}),
    },
    ...(typeof manifest.status === "string" ? { reportedStatus: manifest.status } : {}),
    strict: argv.includes("--strict"),
  } as const;
  let releaseSummary = createReleaseSummary(releaseSummaryInput);
  dependencyAudit = releaseSummary.dependencyAudit;
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
  if (!audit.checks.some((check) => check.checkId === "PACKAGE_ROOT_MISSING" || check.checkId === "PACKAGE_ROOT_INVALID")) {
    try {
      await writeGeneratedReport(audit.packageRoot, "compatibility.json", `${JSON.stringify(releaseSummary.compatibility, null, 2)}\n`);
      await writeGeneratedReport(audit.packageRoot, "reports/release-summary.json", `${JSON.stringify(releaseSummary, null, 2)}\n`);
    } catch (error) {
      audit.checks.push({ checkId: "RELEASE_REPORT_WRITE_FAILED", result: "fail", message: error instanceof Error ? error.message : String(error), path: "reports/release-summary.json" });
      releaseSummary = createReleaseSummary(releaseSummaryInput);
      dependencyAudit = releaseSummary.dependencyAudit;
    }
  }
  const format = optionValue("--format");
  const decision = releaseSummary.release;
  if (format === "json") process.stdout.write(`${JSON.stringify({ ...audit, dependencyAudit, decision, releaseSummary })}\n`);
  else {
    const failed = audit.checks.filter((check) => check.result === "fail");
    const unverified = audit.checks.filter((check) => check.result === "not-verified");
    process.stdout.write(`Offline package audit: ${failed.length ? "failed" : unverified.length ? "not verified" : "passed"}\n`);
    process.stdout.write(`Dependency audit: ${dependencyAudit.status}\n`);
    process.stdout.write(`Delivery decision: ${decision.status}${decision.strict ? " (strict)" : ""}\n`);
    process.stdout.write(`Payload fingerprint: ${audit.payloadFingerprint ?? "unavailable"}\n`);
    for (const check of audit.checks) if (check.result !== "pass") process.stdout.write(`${check.result.toUpperCase()} ${check.checkId}${check.path ? ` ${check.path}` : ""}: ${check.message}\n`);
    for (const gap of releaseSummary.release.gaps) process.stdout.write(`GAP ${gap.result} ${gap.checkId}${gap.path ? ` ${gap.path}` : ""}: ${gap.message} Next: ${gap.action}\n`);
    for (const reason of decision.reasons) process.stdout.write(`DECISION ${reason}\n`);
  }
  process.exitCode = decision.exitCode;
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
  if (!command || !supported.has(command)) fail("CLI_USAGE", "Usage: bdmv-web <inspect|extract|convert|validate|compare> [INPUT] [options]");
  if (command === "inspect") return inspect();
  if (command === "extract") return extract();
  if (command === "convert") return convert();
  if (command === "validate") return validate();
  const mode = optionValue("--mode") ?? "standalone-full"; const strict = strictDefault(); const format = optionValue("--format");
  const detail = { code: "E_NOT_IMPLEMENTED", command, mode, strict, message: `The '${command}' command is not implemented yet.` };
  process.stderr.write(format === "json" ? `${JSON.stringify(detail)}\n` : `${detail.code}: ${detail.message}\n`);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  const e = error instanceof Error ? error : new Error(String(error));
  const code = error instanceof ContractError ? error.code : "E_IO";
  const record = { code, message: e.message, path: error instanceof ContractError ? error.path : null };
  process.stderr.write(optionValue("--format") === "json" ? `${JSON.stringify(record)}\n` : `${code}: ${e.message}\n`);
  process.exitCode = 1;
});
