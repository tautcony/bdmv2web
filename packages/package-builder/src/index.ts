import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { parseDiscIR, type DiscIR, type Limits, type PlayerProfile } from "@bdmv2web/core";
import type { VmOptions, VmProgram } from "@bdmv2web/hdmv";
import { exportMenuLoopMedia, type ExternalMediaTargets, type HdrMode, type MediaAssetProgress, type MediaProcessRunner, type MenuLoopMediaInput, type MenuLoopMediaResult, type PgsDisplaySet, type VideoCodec, assertPngLevel, DEFAULT_CANVAS_PNG_LEVEL } from "@bdmv2web/media-export";

const templateDirectory = existsSync(new URL("./templates/index.html", import.meta.url)) ? "./templates/" : "../templates/";
const PACKAGE_TEMPLATES = {
  menuIndex: readFileSync(new URL(`${templateDirectory}index.html`, import.meta.url), "utf8"),
  style: readFileSync(new URL(`${templateDirectory}style.css`, import.meta.url), "utf8"),
  readme: readFileSync(new URL(`${templateDirectory}README.md`, import.meta.url), "utf8"),
};

function renderTemplate(template: string, values: Record<string, string>, sections: Record<string, boolean> = {}): string {
  const withSections = template.replace(/\{\{#([A-Z_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_match, name: string, contents: string) => sections[name] ? contents : "");
  return withSections.replace(/\{\{([A-Z_]+)\}\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`Template value '${name}' is not defined.`);
    return value;
  });
}

/** A rendered PNG image asset ready for offline embedding. */
export interface PngPayload { id: string; bytes: Uint8Array }
export interface PngBatch { index: number; assets: Array<{ id: string; dataUrl: string; byteLength: number }> }
export interface SoundMetadata { index: number; channelCode: number; sampleRateCode: number; bitsPerSampleCode: number; channels: number | null; sampleRate: number | null; bitsPerSample: number | null; sampleOffset: number; sampleByteLength: number }
export interface SoundPayload { index: number; path: string; byteLength: number; format: "wav-pcm" }
export interface PgsTrackPackageInput { playlistId: string; playlistNumber: number; playItemIndex: number; clipId: string; pid: number; streamNumber: number; language: string; sourceIn90k: string; sourceOut90k: string; source: string; path: string; displaySets: PgsDisplaySet[] }
/** Delivery status as decided by the caller; the package must not invent one. */
export type MenuPackageStatus = "failed" | "partial" | "complete";
export interface MenuPackageDiagnostic { code: string; message: string; severity?: string }
export interface MenuPackageMetadata { schemaVersion: "1.0"; runtimeVersion: string; title: string; status: MenuPackageStatus; diagnostics: MenuPackageDiagnostic[] }

/** Serialize data for a classic script. Escaping '<' also prevents HTML script termination. */
export function serializeSafeScriptData(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item instanceof Uint8Array ? [...item].map((byte) => byte.toString(16).padStart(2, "0")).join("") : item).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** The published CLI carries the menu bundle beside its entry; a workspace build reads the runtime-web export. */
function menuRuntimeBundlePath(): string {
  const besideEntry = fileURLToPath(new URL("runtime/app.bundle.js", import.meta.url));
  return existsSync(besideEntry) ? besideEntry : createRequire(import.meta.url).resolve("@bdmv2web/runtime-web/browser-bundle");
}

export function makePngBatches(assets: PngPayload[], options: { maxAssetBytes?: number; maxBatchBytes?: number; maxTotalBytes?: number } = {}): PngBatch[] {
  const maxAssetBytes = options.maxAssetBytes ?? 1024 * 1024;
  const maxBatchBytes = options.maxBatchBytes ?? 4 * 1024 * 1024;
  const maxTotalBytes = options.maxTotalBytes ?? 64 * 1024 * 1024;
  for (const [name, value] of Object.entries({ maxAssetBytes, maxBatchBytes, maxTotalBytes })) if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  const batches: PngBatch[] = []; let current: PngBatch = { index: 0, assets: [] }; let batchBytes = 0; let totalBytes = 0;
  for (const asset of assets) {
    const length = asset.bytes.byteLength;
    if (!isPng(asset.bytes)) throw new TypeError(`Image asset '${asset.id}' must be encoded as PNG before packaging.`);
    if (length > maxAssetBytes) throw new RangeError(`PNG asset '${asset.id}' exceeds maxAssetBytes`);
    if (length > maxBatchBytes) throw new RangeError(`PNG asset '${asset.id}' exceeds maxBatchBytes`);
    totalBytes += length; if (totalBytes > maxTotalBytes) throw new RangeError("PNG assets exceed maxTotalBytes");
    if (current.assets.length && batchBytes + length > maxBatchBytes) { batches.push(current); current = { index: batches.length, assets: [] }; batchBytes = 0; }
    current.assets.push({ id: asset.id, dataUrl: `data:image/png;base64,${Buffer.from(asset.bytes).toString("base64")}`, byteLength: length }); batchBytes += length;
  }
  if (current.assets.length) batches.push(current);
  return batches;
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
}

/** The stage fills the viewport and letterboxes the scene inside itself: the
 * page shows no chrome of its own, and the disc title is only the document title.
 * The inline aspect-ratio is a fallback hint if the full-viewport sizing is disabled. */
export function createMenuIndexHtml(title: string, assetBatchCount = 0, sceneSize?: { width: number; height: number }, externalPlayback = false): string {
  const safeTitle = escapeHtml(title);
  const assets = Array.from({ length: assetBatchCount }, (_, i) => `<script defer src="runtime/assets-data-${String(i).padStart(3, "0")}.js"></script>`).join("\n  ");
  return renderTemplate(PACKAGE_TEMPLATES.menuIndex, {
    TITLE: safeTitle,
    ASSET_SCRIPTS: assets,
    SCENE_ASPECT_RATIO: sceneSize ? `${sceneSize.width} / ${sceneSize.height}` : "",
  }, {
    EXTERNAL_PLAYBACK: externalPlayback,
    HAS_ASSET_BATCHES: assetBatchCount > 0,
    HAS_SCENE_SIZE: sceneSize !== undefined,
  }).replace(/\n{3,}/g, "\n\n");
}

export function createDataScript(ir: unknown): string {
  return `globalThis.__BDMV_MENU_DATA__=${serializeSafeScriptData(ir)};\n`;
}

export function createAssetBatchScript(batch: PngBatch): string {
  return `globalThis.__BDMV_MENU_ASSETS__=globalThis.__BDMV_MENU_ASSETS__||[];globalThis.__BDMV_MENU_ASSETS__[${batch.index}]=${serializeSafeScriptData(batch.assets)};\n`;
}

export function createCompatibility(metadata: MenuPackageMetadata, externalPlayback = false): Record<string, unknown> {
  return {
    ...metadata,
    profile: "portable",
    coverage: { igs: "unverified" },
    externalDependencies: externalPlayback ? ["configured BDMV STREAM files", "IINA or PotPlayer URL Protocol"] : [],
    notVerified: ["offline directory relocation", "real-disc rendering", "media timeline and seek accuracy"],
  };
}

/** Menu media encoder settings forwarded to every menu media export. */
export interface MenuMediaEncoding {
  crf?: number;
  preset?: "medium" | "fast" | "veryfast" | "ultrafast";
  codec?: VideoCodec;
  hdrMode?: HdrMode;
}

export interface MenuPackageInput {
  outputDirectory: string;
  title: string;
  ir: DiscIR;
  scene: unknown;
  /** Extracted title popup IGS compositions, retained with their source clip/PID. */
  popupScenes?: unknown[];
  /** Extracted IGS compositions keyed by their owning HDMV menu playlist number. */
  menuScenes?: Array<{ playlistId: number; playItem?: number; scene: unknown }>;
  /** HDMV playlist numbers that carry a menu IGS stream. */
  menuPlaylistIds?: number[];
  /** Play mark to PlayItem mapping per menu playlist, so a `PLAY_PLAYLIST_MARK` request selects the right packaged scene. */
  menuPlaylistMarks?: Array<{ playlistId: number; marks: Array<{ index: number; playItemRef: number }> }>;
  preMenuPlaylistIds?: number[];
  /** Validated SUP display sets extracted from reachable playlist PGS streams. */
  pgsTracks?: PgsTrackPackageInput[];
  pgsLimits?: { maxRuntimeBytes?: number };
  /** Delivery status decided by the caller. Defaults to `partial` for library callers. */
  status?: MenuPackageStatus;
  /** Entry counts recorded for report consumers; they never decide the status. */
  entryCounts?: { declared: number; hdmv: number };
  playerProfile?: PlayerProfile;
  vmLimits?: Limits;
  vmPrograms?: VmProgram[];
  vmEntries?: VmOptions["entries"];
  externalTargets?: ExternalMediaTargets;
  bdmvPath?: string;
  vmInitialProgramId?: number;
  vmFirstPlayProgramId?: number;
  inputConfig?: { escapeMapping?: "popup" | "topMenu" | "custom" | "none" };
  graphics: PngPayload[];
  soundEntries?: SoundMetadata[];
  soundBytes?: Uint8Array | null;
  runtimeVersion?: string;
  diagnostics?: MenuPackageMetadata["diagnostics"];
  /** Top Menu background/audio export. */
  menuLoopMedia?: MenuLoopMediaInput;
  /** Menu media encoder settings. Defaults to HEVC / CRF 24 / veryfast / tonemap. */
  mediaEncoding?: MenuMediaEncoding;
  /** Process runner forwarded to menu-media encoding. */
  mediaProcessRunner?: MediaProcessRunner;
  /** Local media for always-on menu playlists other than Top Menu. */
  additionalMenuMedia?: MenuLoopMediaInput[];
  onMediaProgress?: (progress: MediaAssetProgress) => void;
  /** Announces each assembly phase so a caller can report progress: media export, file writes, runtime bundle, manifest. */
  onPhase?: (phase: "media" | "assets" | "bundle" | "manifest") => void;
  /** Previous package directory used as the source for media-plan-matched assets on overwrite. */
  reuseMediaFromDirectory?: string;
  pngLimits?: { maxAssetBytes?: number; maxBatchBytes?: number; maxTotalBytes?: number };
  /** Deflate level 0-9 for packaged PGS display PNGs. Defaults to the tuned canvas level. */
  pngLevel?: number | undefined;
}

/** What the caller can act on after the package is written: the diagnostics recorded in its manifest. */
export interface MenuPackageResult { diagnostics: MenuPackageDiagnostic[] }

/** Write a self-contained menu folder and bundle its browser entry as a classic IIFE. */
export async function buildMenuPackage(input: MenuPackageInput): Promise<MenuPackageResult> {
  const ir = parseDiscIR(input.ir);
  const sceneSize = getSceneSize(input.scene);
  const batches = makePngBatches(input.graphics, input.pngLimits);
  const soundResult = convertSounds(input.soundEntries ?? [], input.soundBytes ?? null, input.scene);
  const sounds = soundResult.assets;
  const diagnostics = [...(input.diagnostics ?? []), ...soundResult.diagnostics];
  const serializedPgsTracks = (input.pgsTracks ?? []).map((track) => serializePgsTrack(track, input.pngLevel));
  const pgsPayloadBytes = Buffer.byteLength(serializeSafeScriptData(serializedPgsTracks));
  const maxPgsRuntimeBytes = input.pgsLimits?.maxRuntimeBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maxPgsRuntimeBytes) || maxPgsRuntimeBytes <= 0) throw new RangeError("maxPgsRuntimeBytes must be a positive safe integer.");
  if (pgsPayloadBytes > maxPgsRuntimeBytes) throw new RangeError(`Serialized PGS payload exceeds maxPgsRuntimeBytes (${pgsPayloadBytes} > ${maxPgsRuntimeBytes} bytes).`);
  const output = resolve(input.outputDirectory); const runtimeDirectory = resolve(output, "runtime");
  await mkdir(runtimeDirectory, { recursive: true });
  input.onPhase?.("media");
  const mediaEncoding = input.mediaEncoding ?? {};
  const exportedMedia = input.menuLoopMedia ? await exportMenuLoopMedia(input.menuLoopMedia, { outputDirectory: output, ...mediaEncoding, ...(input.reuseMediaFromDirectory ? { reuseFromDirectory: input.reuseMediaFromDirectory } : {}), ...(input.mediaProcessRunner ? { runProcess: input.mediaProcessRunner } : {}), ...(input.onMediaProgress ? { onProgress: input.onMediaProgress } : {}) }) : undefined;
  const mediaByKey = new Map<string, { result: MenuLoopMediaResult; planPath: string }>();
  if (input.menuLoopMedia && exportedMedia) mediaByKey.set(menuMediaReuseKey(input.menuLoopMedia, mediaEncoding), { result: exportedMedia, planPath: "media-plan.json" });
  const additionalMedia: Array<{ input: MenuLoopMediaInput; result: MenuLoopMediaResult; planPath: string }> = [];
  for (const media of input.additionalMenuMedia ?? []) {
    // Each PlayItem keeps its own runtime address. Equivalent items share one
    // encoded asset set and its source-traceable plan.
    const sanitizedId = `${media.playlistId}-pi${media.playItemIndex}`.replace(/[^0-9A-Za-z._-]/g, "_");
    const key = menuMediaReuseKey(media, mediaEncoding);
    const existing = mediaByKey.get(key);
    if (existing) {
      additionalMedia.push({ input: media, result: referenceMenuMediaResult(existing.result, media), planPath: existing.planPath });
      continue;
    }
    const planPath = `media-plans/playlist-${sanitizedId}.json`;
    const result = await exportMenuLoopMedia(media, {
      outputDirectory: output,
      ...mediaEncoding,
      assetDirectory: `assets/media/playlist-${sanitizedId}`,
      planPath,
      ...(input.reuseMediaFromDirectory ? { reuseFromDirectory: input.reuseMediaFromDirectory } : {}),
      ...(input.mediaProcessRunner ? { runProcess: input.mediaProcessRunner } : {}),
      ...(input.onMediaProgress ? { onProgress: input.onMediaProgress } : {}),
    });
    additionalMedia.push({ input: media, result, planPath });
    mediaByKey.set(key, { result, planPath });
  }
  // Append shared colour warnings once.
  const mediaResults = [
    ...(exportedMedia ? [exportedMedia] : []),
    ...additionalMedia.map(({ result }) => result),
  ];
  for (const result of mediaResults) for (const warning of result.warnings) {
    if (!diagnostics.some((entry) => entry.code === warning.code)) {
      diagnostics.push({ code: warning.code, message: warning.message, severity: "warning" });
    }
  }
  const runtimeMenuMedia = additionalMedia.map(({ input: media, result }) => ({
    playlist: Number(media.playlistId),
    playItem: media.playItemIndex,
    background: { path: result.background.path, durationSeconds: result.background.durationSeconds, loop: result.background.loop },
    audioTracks: result.audioTracks.map(runtimeAudioTrackMetadata),
  }));
  const metadata: MenuPackageMetadata = { schemaVersion: "1.0", runtimeVersion: input.runtimeVersion ?? "0.1.0", title: input.title, status: input.status ?? "partial", diagnostics };
  const files: Array<{ path: string; kind: string; required?: boolean }> = [
    { path: "index.html", kind: "html", required: true },
    { path: "runtime/disc-data.js", kind: "runtime", required: true },
    { path: "runtime/style.css", kind: "runtime", required: true },
    { path: "README.md", kind: "readme", required: true },
    { path: "compatibility.json", kind: "compatibility", required: true },
    { path: "runtime/app.bundle.js", kind: "runtime", required: true },
    ...batches.map((batch) => ({ path: `runtime/assets-data-${String(batch.index).padStart(3, "0")}.js`, kind: "runtime", required: true })),
    ...sounds.map((sound) => ({ path: sound.path, kind: "audio", required: true })),
    ...(exportedMedia?.files.map((file) => ({ path: file.path, kind: "media", required: true })) ?? []),
    ...additionalMedia.flatMap(({ result }) => result.files.map((file) => ({ path: file.path, kind: "media", required: true }))),
    ...[...new Set((input.pgsTracks ?? []).map((track) => track.path))].map((path) => ({ path, kind: "subtitle", required: true })),
    ...[...new Set([...(exportedMedia ? ["media-plan.json"] : []), ...additionalMedia.map(({ planPath }) => planPath)])].map((path) => ({ path, kind: "media-plan", required: true })),
    ...(input.externalTargets ? [{ path: "runtime/bdmv-config.js", kind: "external-config", required: true }, { path: "external-targets.json", kind: "runtime", required: true }] : []),
  ];
  input.onPhase?.("assets");
  await Promise.all([
    writeFile(resolve(output, "index.html"), createMenuIndexHtml(input.title, batches.length, sceneSize, !!input.externalTargets)),
    writeFile(resolve(runtimeDirectory, "disc-data.js"), createDataScript({ ir, title: input.title, scene: input.scene, ...(input.popupScenes?.length ? { popupScenes: input.popupScenes } : {}), ...(input.menuScenes?.length ? { menuScenes: input.menuScenes } : {}), ...(input.menuPlaylistIds?.length ? { menuPlaylistIds: input.menuPlaylistIds } : {}), ...(input.menuPlaylistMarks?.length ? { menuPlaylistMarks: input.menuPlaylistMarks } : {}), ...(input.preMenuPlaylistIds?.length ? { preMenuPlaylistIds: input.preMenuPlaylistIds } : {}), ...(serializedPgsTracks.length ? { pgsTracks: serializedPgsTracks } : {}), vmPrograms: input.vmPrograms ?? [], ...(input.playerProfile ? { profile: input.playerProfile } : {}), ...(input.vmLimits ? { limits: input.vmLimits } : {}), ...(input.externalTargets ? { externalTargets: input.externalTargets } : {}), ...(input.vmEntries ? { vmEntries: input.vmEntries } : {}), ...(input.vmInitialProgramId !== undefined ? { vmInitialProgramId: input.vmInitialProgramId } : {}), ...(input.vmFirstPlayProgramId !== undefined ? { vmFirstPlayProgramId: input.vmFirstPlayProgramId } : {}), inputConfig: { escapeMapping: input.inputConfig?.escapeMapping ?? "popup" }, sounds: Object.fromEntries(sounds.map(({ index, path }) => [index, path])), ...(exportedMedia ? { media: { playlist: Number(input.menuLoopMedia!.playlistId), playItem: exportedMedia.plan.playItemIndex, background: { path: exportedMedia.background.path, durationSeconds: exportedMedia.background.durationSeconds, loop: exportedMedia.background.loop }, audioTracks: exportedMedia.audioTracks.map(runtimeAudioTrackMetadata) } } : {}), ...(runtimeMenuMedia.length ? { menuMedia: runtimeMenuMedia } : {}) })),
    ...(input.externalTargets ? [writeFile(resolve(runtimeDirectory, "bdmv-config.js"), `globalThis.__BDMV_BDMV_PATH__=${serializeSafeScriptData(input.bdmvPath ?? "../BDMV")};\n`)] : []),
    writeFile(resolve(runtimeDirectory, "style.css"), PACKAGE_TEMPLATES.style),
    writeFile(resolve(output, "README.md"), createReadme(input.title, exportedMedia?.background.loop, !!input.externalTargets, metadata.status)),
    ...(input.externalTargets ? [writeFile(resolve(output, "external-targets.json"), `${JSON.stringify(input.externalTargets)}\n`)] : []),
    ...batches.map((batch) => writeFile(resolve(runtimeDirectory, `assets-data-${String(batch.index).padStart(3, "0")}.js`), createAssetBatchScript(batch))),
    ...soundResult.files.map(async ({ path, bytes }) => { await mkdir(resolve(output, "assets/audio"), { recursive: true }); await writeFile(resolve(output, path), bytes); }),
    writeFile(resolve(output, "asset-manifest.json"), `${JSON.stringify({ schemaVersion: "1.0", sounds, ...(exportedMedia ? { media: packagedMediaMetadata(exportedMedia) } : {}), ...(additionalMedia.length ? { menuMedia: additionalMedia.map(({ result }) => packagedMediaMetadata(result)) } : {}), pgsTracks: (input.pgsTracks ?? []).map(({ displaySets: _displaySets, ...track }) => ({ ...track, displaySetCount: _displaySets.length })) }, null, 2)}\n`),
  ]);
  // The menu runtime bundle is built by runtime-web during the workspace build, so packaging only copies it.
  input.onPhase?.("bundle");
  await writeFile(resolve(runtimeDirectory, "app.bundle.js"), await readFile(menuRuntimeBundlePath()));
  input.onPhase?.("manifest");
  await writeFile(resolve(output, "compatibility.json"), `${JSON.stringify(createCompatibility(metadata, !!input.externalTargets), null, 2)}\n`);
  // M6 reserves compatibility.json and asset-manifest.json as report metadata and rejects them in manifest.files.
  const manifestFiles = await Promise.all(files.filter((file) => file.path !== "compatibility.json" && file.path !== "asset-manifest.json").map(async (file) => {
    const fileInfo = await stat(resolve(output, file.path));
    return { ...file, byteLength: String(fileInfo.size) };
  }));
  manifestFiles.sort((a, b) => a.path.localeCompare(b.path, "en"));
  const menuMediaLimitation = input.externalTargets ? "External playback uses IINA on macOS and PotPlayer on Windows; IINA chapter positions use `mpv_start`; PotPlayer opens the selected M2TS." : exportedMedia ? exportedMedia.background.loop ? "Menu background uses a repeated single-clip loop." : "Menu background holds its final frame after the single PlayItem; declared audio ends with the PlayItem." : "Menu background media is unavailable";
  const pgsManifest = (input.pgsTracks ?? []).map(({ displaySets, ...track }) => ({ ...track, displaySetCount: displaySets.length }));
  const manifest = { schemaVersion: "1.0", status: metadata.status, ...(input.entryCounts ? { declaredEntryCount: input.entryCounts.declared, hdmvEntryCount: input.entryCounts.hdmv } : {}), files: manifestFiles, diagnostics: metadata.diagnostics, ...(input.playerProfile ? { profile: input.playerProfile } : {}), assets: { sounds, ...(exportedMedia ? { media: packagedMediaMetadata(exportedMedia) } : {}), ...(additionalMedia.length ? { menuMedia: additionalMedia.map(({ result }) => packagedMediaMetadata(result)) } : {}), pgsTracks: pgsManifest }, limitations: [menuMediaLimitation, "IGS effect sequences are rendered and presented; effect flag semantics are verified for the synthetic fixtures only"] };
  await writeFile(resolve(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  // Return post-encoding media warnings in diagnostics. The caller supplies package status.
  return { diagnostics: metadata.diagnostics };
}

/** Convert only M1-declared 48 kHz, signed 16-bit mono/stereo PCM sample ranges. BCLK words are big-endian. */
export function convertSounds(entries: SoundMetadata[], source: Uint8Array | null, scene: unknown): { assets: SoundPayload[]; diagnostics: MenuPackageDiagnostic[]; files: Array<{ path: string; bytes: Uint8Array }> } {
  const references = getSoundReferences(scene); const declared = new Map(entries.map((entry) => [entry.index, entry]));
  const assets: SoundPayload[] = []; const diagnostics: Array<{ code: string; message: string }> = []; const files: Array<{ path: string; bytes: Uint8Array }> = [];
  const affected = (soundId: number) => references.get(soundId)?.map((ref) => `page ${ref.pageId}, button ${ref.buttonId}`).join("; ") ?? "no menu buttons";
  for (const soundId of new Set(references.keys())) {
    const entry = declared.get(soundId);
    if (!entry) { diagnostics.push({ code: "SOUND_REFERENCE_MISSING", message: `Sound ${soundId} is referenced by ${affected(soundId)} but has no M1 sound entry.` }); continue; }
    if (!source) { diagnostics.push({ code: "SOUND_SOURCE_MISSING", message: `Sound ${soundId} is referenced by ${affected(soundId)} but sound.bdmv bytes are unavailable.` }); continue; }
    if (entry.channels !== 1 && entry.channels !== 2 || entry.sampleRate !== 48000 || entry.bitsPerSample !== 16 || entry.channelCode !== (entry.channels === 1 ? 1 : 3) || entry.sampleRateCode !== 1 || entry.bitsPerSampleCode !== 1) {
      diagnostics.push({ code: "SOUND_FORMAT_UNSUPPORTED", message: `Sound ${soundId} referenced by ${affected(soundId)} has unsupported M1 PCM attributes (channel=${entry.channelCode}, rate=${entry.sampleRateCode}, bits=${entry.bitsPerSampleCode}).` }); continue;
    }
    const { sampleOffset, sampleByteLength } = entry;
    if (!Number.isSafeInteger(sampleOffset) || !Number.isSafeInteger(sampleByteLength) || sampleOffset < 0 || sampleByteLength < 0 || sampleOffset > source.byteLength || sampleByteLength > source.byteLength - sampleOffset || sampleByteLength % (entry.channels * 2) !== 0 || sampleByteLength > 0xffffffff - 36) {
      diagnostics.push({ code: "SOUND_RANGE_INVALID", message: `Sound ${soundId} referenced by ${affected(soundId)} has an invalid or truncated M1 sample range.` }); continue;
    }
    const wav = makePcmWav(source.subarray(sampleOffset, sampleOffset + sampleByteLength), entry.channels);
    const path = `assets/audio/sound-${soundId}.wav`; assets.push({ index: soundId, path, byteLength: wav.byteLength, format: "wav-pcm" }); files.push({ path, bytes: wav });
  }
  return { assets, diagnostics, files };
}

function makePcmWav(samples: Uint8Array, channels: number): Uint8Array {
  const wav = new Uint8Array(44 + samples.byteLength); const view = new DataView(wav.buffer);
  const write = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) wav[offset + i] = value.charCodeAt(i); };
  write(0, "RIFF"); view.setUint32(4, 36 + samples.byteLength, true); write(8, "WAVE"); write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, 48000, true); view.setUint32(28, 48000 * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, samples.byteLength, true);
  for (let i = 0; i < samples.byteLength; i += 2) { wav[44 + i] = samples[i + 1]!; wav[44 + i + 1] = samples[i]!; }
  return wav;
}

function getSoundReferences(scene: unknown): Map<number, Array<{ pageId: number; buttonId: number }>> {
  const result = new Map<number, Array<{ pageId: number; buttonId: number }>>();
  if (typeof scene !== "object" || scene === null || !Array.isArray((scene as { pages?: unknown }).pages)) return result;
  for (const page of (scene as { pages: Array<{ id?: number; buttons?: Array<{ id?: number; states?: Record<string, { soundId?: number }> }> }> }).pages) for (const button of page.buttons ?? []) for (const state of Object.values(button.states ?? {})) {
    const id = state?.soundId; if (!Number.isInteger(id) || id === 0xff || id! < 0) continue;
    const refs = result.get(id!) ?? []; refs.push({ pageId: page.id ?? -1, buttonId: button.id ?? -1 }); result.set(id!, refs);
  }
  return result;
}

function getSceneSize(scene: unknown): { width: number; height: number } {
  if (typeof scene !== "object" || scene === null || !Number.isSafeInteger((scene as { width?: unknown }).width) || !Number.isSafeInteger((scene as { height?: unknown }).height) || (scene as { width: number }).width <= 0 || (scene as { height: number }).height <= 0) throw new TypeError("Menu scene must declare positive integer width and height");
  return { width: (scene as { width: number }).width, height: (scene as { height: number }).height };
}

export function createReadme(title: string, backgroundLoops: boolean | undefined, externalPlayback: boolean, status: MenuPackageStatus = "partial"): string {
  const rendered = renderTemplate(PACKAGE_TEMPLATES.readme, {
    TITLE: title.replace(/[\r\n]/g, " "),
    STATUS: status,
  }, {
    BACKGROUND_LOOP: backgroundLoops === true,
    BACKGROUND_SINGLE_PLAY_ITEM: backgroundLoops === false,
    BACKGROUND_UNAVAILABLE: backgroundLoops === undefined,
    EXTERNAL_PLAYBACK: externalPlayback,
  });
  return rendered.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function runtimeAudioTrackMetadata(track: { streamNumber?: number; path: string; language: string; durationSeconds?: number }): { streamNumber: number; psrStreamNumber: number; path: string; language: string; durationSeconds?: number } {
  if (!Number.isSafeInteger(track.streamNumber) || track.streamNumber! < 0) throw new TypeError("Exported audio track requires its zero-based STN streamNumber.");
  return { streamNumber: track.streamNumber!, psrStreamNumber: track.streamNumber! + 1, path: track.path, language: track.language, ...(track.durationSeconds === undefined ? {} : { durationSeconds: track.durationSeconds }) };
}

function serializePgsTrack(track: PgsTrackPackageInput, pngLevel: number | undefined) {
  if (!Number.isSafeInteger(track.pid) || !Number.isSafeInteger(track.streamNumber) || track.streamNumber <= 0 || !Number.isSafeInteger(track.playItemIndex) || track.playItemIndex < 0) throw new TypeError("PGS package track has invalid PID, stream number, or PlayItem index.");
  if (BigInt(track.sourceOut90k) <= BigInt(track.sourceIn90k)) throw new TypeError("PGS package track has an invalid source interval.");
  return {
    playlistId: track.playlistId, playlistNumber: track.playlistNumber, playItemIndex: track.playItemIndex,
    clipId: track.clipId, pid: track.pid, streamNumber: track.streamNumber, language: track.language,
    sourceIn90k: track.sourceIn90k, sourceOut90k: track.sourceOut90k, source: track.source, path: track.path,
    displaySets: track.displaySets.map((set) => ({
      pts90k: set.pts90k, width: set.width, height: set.height, compositionNumber: set.compositionNumber,
      compositionState: set.compositionState, paletteId: set.paletteId,
      palette: [...set.palette].map(([index, rgba]) => [index, [...rgba]]),
      bitmaps: [...set.bitmaps.values()].map((bitmap) => ({ objectId: bitmap.objectId, width: bitmap.width, height: bitmap.height })),
      imageBase64: encodePgsDisplayPng(set, pngLevel),
      placements: set.placements,
    })),
  };
}

function encodePgsDisplayPng(set: PgsDisplaySet, pngLevel: number | undefined): string {
  const rgba = new Uint8Array(set.width * set.height * 4);
  for (const placement of set.placements) {
    const bitmap = set.bitmaps.get(placement.objectId);
    if (!bitmap) continue;
    const pixels = bitmap.pixels;
    const { width, height } = bitmap;
    const crop = placement.crop ?? { x: 0, y: 0, width, height };
    for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) {
      const sourceX = crop.x + x, sourceY = crop.y + y;
      const targetX = placement.x + x, targetY = placement.y + y;
      if (sourceX >= width || sourceY >= height || targetX < 0 || targetY < 0 || targetX >= set.width || targetY >= set.height) continue;
      const sourceOffset = (sourceY * width + sourceX) * 4;
      const targetOffset = (targetY * set.width + targetX) * 4;
      const sourceAlpha = pixels[sourceOffset + 3]! / 255;
      if (sourceAlpha === 0) continue;
      const targetAlpha = rgba[targetOffset + 3]! / 255;
      const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
      for (let channel = 0; channel < 3; channel++) {
        rgba[targetOffset + channel] = Math.round((pixels[sourceOffset + channel]! * sourceAlpha + rgba[targetOffset + channel]! * targetAlpha * (1 - sourceAlpha)) / outputAlpha);
      }
      rgba[targetOffset + 3] = Math.round(outputAlpha * 255);
    }
  }
  const scanlines = Buffer.alloc(set.height * (set.width * 4 + 1));
  for (let y = 0; y < set.height; y++) scanlines.set(rgba.subarray(y * set.width * 4, (y + 1) * set.width * 4), y * (set.width * 4 + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(set.width, 0); header.writeUInt32BE(set.height, 4); header[8] = 8; header[9] = 6;
  // Level 9 cost twice level 6 and saved 2% of the bytes on a full-HD subtitle canvas,
  // so the package path now defaults to the tuned canvas level.
  const level = assertPngLevel(pngLevel ?? DEFAULT_CANVAS_PNG_LEVEL);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(scanlines, { level })), pngChunk("IEND", Buffer.alloc(0))]);
  return png.toString("base64");
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const contents = Buffer.concat([typeBytes, data]);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0); contents.copy(chunk, 4); chunk.writeUInt32BE(crc32(contents), data.length + 8);
  return chunk;
}

export function packagedMediaMetadata(media: Awaited<ReturnType<typeof exportMenuLoopMedia>>): Record<string, unknown> {
  return {
    plan: media.plan,
    outputSize: media.outputSize,
    background: { path: media.background.path, byteLength: media.background.byteLength, codec: media.background.codec, pid: media.background.pid, width: media.background.width, height: media.background.height, durationSeconds: media.background.durationSeconds, loop: media.background.loop },
    audioTracks: media.audioTracks.map((track) => ({ ...runtimeAudioTrackMetadata(track), byteLength: track.byteLength, codec: track.codec, pid: track.pid, durationSeconds: track.durationSeconds })),
  };
}

function menuMediaReuseKey(media: MenuLoopMediaInput, encoding: MenuMediaEncoding): string {
  const codec = encoding.codec ?? "hevc";
  return JSON.stringify({
    sourcePath: resolve(media.sourcePath),
    sourceFile: media.sourceFile,
    playlistId: media.playlistId,
    clipId: media.clipId,
    inTime45k: media.inTime45k,
    loopStart45k: media.loopStart45k ?? null,
    outTime45k: media.outTime45k,
    stillMode: media.stillMode,
    repeatCount: media.repeatCount,
    loopBackground: media.loopBackground ?? (media.stillMode !== 2 && media.repeatCount > 1),
    videoPid: media.videoPid,
    audioTracks: media.audioTracks.map(({ streamNumber, pid, language }) => [streamNumber, pid, language]),
    encoding: {
      codec,
      crf: encoding.crf ?? (codec === "hevc" ? 24 : 18),
      preset: encoding.preset ?? "veryfast",
      hdrMode: encoding.hdrMode ?? "tonemap",
    },
  });
}

function referenceMenuMediaResult(media: MenuLoopMediaResult, input: MenuLoopMediaInput): MenuLoopMediaResult {
  return {
    ...media,
    plan: { ...media.plan, playlistId: input.playlistId, playItemIndex: input.playItemIndex },
    tools: { ffmpeg: "reused", ffprobe: "reused", invocations: [] },
    files: [],
  };
}

function escapeHtml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
