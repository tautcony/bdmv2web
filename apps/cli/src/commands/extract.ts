import { safeAssetLanguage } from "../cli/assets.js";
import { flagEnabled, inputPath, optionValue, strictDefault } from "../cli/context.js";
import { fail } from "../cli/errors.js";
import { firstBlockingCode, stageFailure } from "../cli/stages.js";
import { buildExternalTargets } from "../shared/media.js";
import { extractReachablePgsTracks } from "../shared/pgs.js";
import { assertDisjointRoots, beginOutputTransaction } from "@bdmv2web/bdmv-io";
import { parseBdmv } from "@bdmv2web/bdmv-parser";
import { extractIgsScenes } from "@bdmv2web/igs";
import { classifyDiagnostics, decideStageOutcome } from "@bdmv2web/test-runner";
import { lstat, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function extract(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "extract requires an input path");
  const out = optionValue("--out"); if (!out) fail("CLI_MISSING_OUTPUT", "extract requires --out DIR");
  const selectedType = optionValue("--type");
  const all = flagEnabled("--all");
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
    // Schema 1.1 replaces the per-object RLE index array with indicesLength:
    // the same schemaVersion must not change payload shape between releases.
    const sceneJson = `${JSON.stringify({ schemaVersion: "1.1", status: igs.status, support: igs.support, scenes: sceneRecords }, null, 2)}\n`;
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
      const tracks = await extractReachablePgsTracks(disc, igs.scenes, transaction.stagingPath, (reference, index) => `sup/${reference.clipId}-pid-${reference.pid.toString(16).padStart(4, "0")}-${safeAssetLanguage(reference.language)}-${String(index + 1).padStart(3, "0")}.sup`);
      const uniqueTracks = [...new Map(tracks.map((track) => [track.path, track])).values()];
      const trackRecords = [];
      for (const track of uniqueTracks) { const info = await lstat(resolve(transaction.stagingPath, track.path)); trackRecords.push({ clipId: track.clipId, pid: track.pid, language: track.language, streamNumber: track.streamNumber, displaySetCount: track.displaySets.length, byteLength: info.size }); await unlink(resolve(transaction.stagingPath, track.path)); }
      await mkdir(resolve(transaction.stagingPath, "sup"), { recursive: true });
      await writeFile(resolve(transaction.stagingPath, "sup/tracks.json"), `${JSON.stringify({ schemaVersion: "1.0", tracks: trackRecords }, null, 2)}\n`, { flag: "wx" });
      generatedFiles.push(await generatedFileRecord(transaction.stagingPath, "sup/tracks.json", "sup-track-index"));
    }
    const manifest = { schemaVersion: "1.0", stageStatus: outcome.status, analysisStage: "structural", selectedTypes: [includeHdmv ? "hdmv" : null, includeIgs ? "igs" : null, includeSup ? "sup" : null].filter(Boolean), igs: { status: igs.status, support: igs.support }, files: generatedFiles, limitations: ["IGS effect sequences are rendered and presented; effect flag semantics are verified for the synthetic fixtures only", "dynamic MovieObject command targets are unresolved", "BD-J execution is unsupported"] };
    await writeFile(resolve(transaction.stagingPath, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    await transaction.commit();
    process.stdout.write(`${JSON.stringify({ stageStatus: outcome.status, output: roots.output })}\n`);
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
  } catch (error) { await transaction.abort(); throw error; }
}

export async function generatedFileRecord(root: string, path: string, kind: string): Promise<{ path: string; kind: string; byteLength: string }> {
  const result = await stat(resolve(root, path));
  return { path, kind, byteLength: String(result.size) };
}

export function mapIgsSource(source: { clipId: string; pid: number; packetOffset: string; pesOffset: string; segmentOffset: string; segmentFileOffset: string; pts90k: string | null; timeDomain: number }): Record<string, string | number | null> {
  return { path: `BDMV/STREAM/${source.clipId}.m2ts`, pid: source.pid, packetOffset: source.packetOffset, pesOffset: source.pesOffset, segmentOffset: source.segmentOffset, byteOffset: source.segmentFileOffset, pts90k: source.pts90k, timeDomain: source.timeDomain };
}

export function serializeIgsScene(scene: Awaited<ReturnType<typeof extractIgsScenes>>["scenes"][number]): Record<string, unknown> {
  return {
    id: scene.id, clipId: scene.clipId, pid: scene.pid, compositionNumber: scene.compositionNumber,
    compositionState: scene.compositionState, width: scene.width, height: scene.height, timeDomain: scene.timeDomain,
    pts90k: scene.pts90k, streamModel: scene.streamModel, uiModel: scene.uiModel,
    compositionTimeout90k: scene.compositionTimeout90k, selectionTimeout90k: scene.selectionTimeout90k,
    userTimeoutDuration: scene.userTimeoutDuration, rawIcs: Array.from(scene.rawIcs), complete: scene.complete,
    source: mapIgsSource(scene.source),
    pages: scene.pages.map((page) => ({ ...page, uoMask: page.uoMask.toString(10), buttons: page.buttons.map((button) => ({ ...button, commands: button.commands.map((command) => ({ ...command, bytes: Array.from(command.bytes) })) })) })),
    // Pixel indices belong to the rendered asset stage; embedding them here makes
    // large menus exceed the JSON string limit. Keep object metadata and length only.
    objects: scene.objects.map(({ indices, ...object }) => ({ ...object, indicesLength: indices.length, source: mapIgsSource(object.source) })),
    palettes: scene.palettes.map((palette) => ({ id: palette.id, version: palette.version, entries: [...palette.entries].map(([id, entry]) => ({ id, ...entry })), source: mapIgsSource(palette.source) })),
  };
}

export function safeDiagnosticMessage(message: string, sourceRoot: string): string {
  return message.split(sourceRoot).join("<source>").replace(/\bBDMV\/[^\s,;:)]+/gi, "<source-file>");
}

export function referencedAssetIds(value: unknown): Set<string> {
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
