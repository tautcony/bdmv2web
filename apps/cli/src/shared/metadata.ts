import { buildExternalTargets } from "./media.js";
import type { ParsedDisc } from "@bdmv2web/bdmv-parser";
import type { extractIgsScenes } from "@bdmv2web/igs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * The metadata artifacts a metadata-only `export` writes (`--metadata-only`, or
 * `--type metadata`) and the structural set it can add to an asset run.
 *
 * They describe what was read (structure, provenance, track index) and never carry
 * decoded bytes: `.mnu`/`.sup` containers and PNGs belong to the asset side of the
 * same pipeline. Both callers share this writer so the files, the manifest and the
 * scrubbed diagnostic messages stay one shape.
 */

export type IgsExtraction = Awaited<ReturnType<typeof extractIgsScenes>>;

export interface GeneratedFile { path: string; kind: string; byteLength: string }

/** One reachable SUP track, as the analysis index records it (no bytes). */
export interface SupTrackRecord {
  clipId: string;
  pid: number;
  language: string;
  streamNumber: number;
  displaySetCount: number;
  byteLength: number;
}

export interface MetadataSections { hdmv: boolean; igs: boolean; sup: boolean }

export interface MetadataRequest {
  stagingPath: string;
  status: "complete" | "partial";
  sections: MetadataSections;
  /** `null` for a stream-file input, which carries no HDMV command table. */
  disc: ParsedDisc | null;
  igs: Pick<IgsExtraction, "scenes" | "assets" | "diagnostics" | "status" | "support">;
  supTracks: SupTrackRecord[];
  /** `hdmv/external-media-targets.json` is an `--type all` artifact. */
  externalTargets: boolean;
  /** Disc root replaced by `<source>` in diagnostic messages; `null` leaves them as is. */
  sourceRoot: string | null;
}

const LIMITATIONS = [
  "IGS effect sequences are rendered and presented; effect flag semantics are verified for the synthetic fixtures only",
  "dynamic MovieObject command targets are unresolved",
  "writing structural metadata does not start the browser BD-J runtime",
];

export async function writeMetadataArtifacts(request: MetadataRequest): Promise<GeneratedFile[]> {
  const { stagingPath } = request;
  const files: GeneratedFile[] = [];
  if (request.sections.hdmv && request.disc) files.push(...await writeHdmv(stagingPath, request.disc, request));
  if (request.sections.igs) files.push(...await writeIgs(stagingPath, request));
  if (request.sections.sup) {
    await mkdir(resolve(stagingPath, "sup"), { recursive: true });
    await writeJson(stagingPath, "sup/tracks.json", { schemaVersion: "1.0", tracks: request.supTracks });
    files.push(await generatedFileRecord(stagingPath, "sup/tracks.json", "sup-track-index"));
  }
  const manifest = {
    schemaVersion: "1.0",
    stageStatus: request.status,
    analysisStage: "structural",
    selectedTypes: [request.sections.hdmv ? "hdmv" : null, request.sections.igs ? "igs" : null, request.sections.sup ? "sup" : null].filter(Boolean),
    igs: { status: request.igs.status, support: request.igs.support },
    files,
    limitations: LIMITATIONS,
  };
  await writeJson(stagingPath, "manifest.json", manifest);
  return files;
}

async function writeHdmv(stagingPath: string, disc: ParsedDisc, request: MetadataRequest): Promise<GeneratedFile[]> {
  await mkdir(resolve(stagingPath, "hdmv"), { recursive: true });
  const commandTable = disc.movieObjects.flatMap((object) => object.instructions.map((instruction, instructionIndex) => ({ movieObjectId: object.id, instructionIndex, words: instruction.words, bytes: instruction.bytes, source: instruction.source })));
  await writeJson(stagingPath, "hdmv/commands.json", commandTable);
  await writeJson(stagingPath, "hdmv/source-map.json", createHdmvSourceMap(disc));
  await writeJson(stagingPath, "hdmv/parsed-disc.json", disc);
  const files = [
    await generatedFileRecord(stagingPath, "hdmv/parsed-disc.json", "parsed-disc"),
    await generatedFileRecord(stagingPath, "hdmv/commands.json", "hdmv-command-table"),
    await generatedFileRecord(stagingPath, "hdmv/source-map.json", "hdmv-source-map"),
  ];
  if (request.externalTargets) {
    await writeJson(stagingPath, "hdmv/external-media-targets.json", buildExternalTargets(disc, request.igs.scenes));
    files.push(await generatedFileRecord(stagingPath, "hdmv/external-media-targets.json", "external-media-targets"));
  }
  return files;
}

async function writeIgs(stagingPath: string, request: MetadataRequest): Promise<GeneratedFile[]> {
  const scrub = (message: string): string => request.sourceRoot === null ? message : safeDiagnosticMessage(message, request.sourceRoot);
  await mkdir(resolve(stagingPath, "igs"), { recursive: true });
  const scenes = request.igs.scenes.map((scene) => ({ id: scene.id, raw: serializeIgsScene(scene) }));
  await writeJson(stagingPath, "igs/scenes.json", { schemaVersion: "1.1", status: request.igs.status, support: request.igs.support, scenes });
  const diagnosticRecords = request.igs.diagnostics.map((item) => ({ ...item, message: scrub(item.message) }));
  await writeJson(stagingPath, "igs/diagnostics.json", { schemaVersion: "1.0", status: request.igs.status, diagnostics: diagnosticRecords });
  await writeJson(stagingPath, "igs/source-map.json", createIgsSourceMap(request.igs));
  return [
    await generatedFileRecord(stagingPath, "igs/scenes.json", "igs-scenes"),
    await generatedFileRecord(stagingPath, "igs/diagnostics.json", "igs-diagnostics"),
    await generatedFileRecord(stagingPath, "igs/source-map.json", "source-map"),
  ];
}

async function writeJson(stagingPath: string, path: string, value: unknown): Promise<void> {
  await writeFile(resolve(stagingPath, path), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

export async function generatedFileRecord(root: string, path: string, kind: string): Promise<GeneratedFile> {
  const result = await stat(resolve(root, path));
  return { path, kind, byteLength: String(result.size) };
}

export function createHdmvSourceMap(disc: Pick<ParsedDisc, "movieObjects">) {
  return {
    schemaVersion: "1.0",
    instructions: disc.movieObjects.flatMap((object) => object.instructions.map((instruction) => ({
      movieObjectId: object.id,
      instructionIndex: instruction.source.instructionIndex,
      source: { path: instruction.source.path, origin: instruction.source.origin, byteOffset: instruction.source.offset, instructionIndex: instruction.source.instructionIndex },
    }))),
  };
}

type IgsSourceMapInput = {
  clipId: string | null;
  pid: number | null;
  path?: string | null;
  origin?: "primary" | "backup" | null;
  sourceOffset?: string | null;
  packetOffset: string | null;
  pesOffset: string | null;
  segmentOffset: string | null;
  segmentFileOffset: string | null;
  pts90k: string | null;
  timeDomain: number | null;
  stage?: "structural" | "transport";
};

export function mapIgsSource(source: IgsSourceMapInput): Record<string, string | number | null> {
  const stage = source.stage ?? "transport";
  return {
    path: source.path ?? null, clipId: source.clipId, pid: source.pid, origin: source.origin ?? null, stage,
    byteOffset: stage === "structural" ? source.sourceOffset ?? null : source.segmentFileOffset,
    sourceOffset: source.sourceOffset ?? null,
    packetOffset: source.packetOffset, pesOffset: source.pesOffset, segmentOffset: source.segmentOffset,
    segmentFileOffset: source.segmentFileOffset, pts90k: source.pts90k, timeDomain: source.timeDomain,
  };
}

export function mapIgsDiagnosticSource(diagnostic: { code: string; source: IgsSourceMapInput | null; stage?: "structural" | "transport" | "pes" | "igs" | "render" }) {
  const stage = diagnostic.stage ?? diagnosticStage(diagnostic.code);
  return { source: diagnostic.source ? mapIgsSource(diagnostic.source) : null, stage };
}

export function createIgsSourceMap(igs: Pick<IgsExtraction, "scenes" | "assets" | "diagnostics">) {
  return {
    schemaVersion: "1.0",
    scenes: igs.scenes.map((scene) => ({ sceneId: scene.id, composition: mapIgsSource(scene.source), pages: scene.pages.map((page) => ({ pageId: page.id, buttons: page.buttons.map((button) => ({ buttonId: button.id, commands: button.commands.map((command) => ({ recordIndex: command.recordIndex, sourceOffset: command.sourceOffset, source: mapIgsSource(scene.source) })) })) })), objects: scene.objects.map((object) => ({ objectId: object.id, version: object.version, source: mapIgsSource(object.source) })), palettes: scene.palettes.map((palette) => ({ paletteId: palette.id, version: palette.version, source: mapIgsSource(palette.source) })) })),
    assets: igs.assets.map((asset) => ({ assetId: asset.id, path: asset.relativePath, objectId: asset.objectId, objectVersion: asset.objectVersion, paletteId: asset.paletteId, paletteVersion: asset.paletteVersion, source: mapIgsSource(asset.source), colorConversion: asset.colorConversion })),
    diagnostics: igs.diagnostics.map((diagnostic, index) => ({ index, ...mapIgsDiagnosticSource(diagnostic), affectedSceneIds: diagnostic.affectedSceneIds })),
  };
}

function diagnosticStage(code: string): "structural" | "transport" | "pes" | "igs" | "render" {
  if (code.startsWith("BDMV_")) return "structural";
  if (code.startsWith("TS_") || code.startsWith("PSI_") || code === "IGS_PID_UNRESOLVED" || code === "LIMIT_EXCEEDED") return "transport";
  if (code.startsWith("PES_") || code.startsWith("PTS_")) return "pes";
  if (code.startsWith("UNRESOLVED_") || code.startsWith("RENDER_")) return "render";
  return "igs";
}

export function serializeIgsScene(scene: IgsExtraction["scenes"][number]): Record<string, unknown> {
  return {
    id: scene.id, clipId: scene.clipId, pid: scene.pid, compositionNumber: scene.compositionNumber,
    compositionState: scene.compositionState, width: scene.width, height: scene.height, timeDomain: scene.timeDomain,
    pts90k: scene.pts90k, streamModel: scene.streamModel, uiModel: scene.uiModel,
    compositionTimeout90k: scene.compositionTimeout90k, selectionTimeout90k: scene.selectionTimeout90k,
    userTimeoutDuration: scene.userTimeoutDuration, rawIcs: Array.from(scene.rawIcs), complete: scene.complete,
    source: mapIgsSource(scene.source),
    pages: scene.pages.map((page) => ({ ...page, uoMask: page.uoMask.toString(10), buttons: page.buttons.map((button) => ({ ...button, commands: button.commands.map((command) => ({ ...command, bytes: Array.from(command.bytes) })) })) })),
    objects: scene.objects.map((object) => ({ ...withoutPixelIndices(object), source: mapIgsSource(object.source) })),
    palettes: scene.palettes.map((palette) => ({ id: palette.id, version: palette.version, entries: [...palette.entries].map(([id, entry]) => ({ id, ...entry })), source: mapIgsSource(palette.source) })),
  };
}

function withoutPixelIndices<T extends { indices: Uint8Array }>(object: T): Omit<T, "indices"> & { indicesLength: number } {
  const { indices, ...rest } = object;
  return { ...rest, indicesLength: indices.length };
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
