import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { parseDiscIR, type DiscIR, type Limits, type PlayerProfile } from "@bdmv2web/core";
import type { VmOptions, VmProgram } from "@bdmv2web/hdmv";
import { exportMenuLoopMedia, type ExternalMediaTargets, type HdrMode, type MediaAssetProgress, type MenuLoopMediaInput, type PgsDisplaySet, type VideoCodec } from "@bdmv2web/media-export";

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
  const assets = Array.from({ length: assetBatchCount }, (_, i) => `<script defer src="runtime/assets-data-${String(i).padStart(3, "0")}.js"></script>`).join("");
  const aspectRatio = sceneSize ? ` style="aspect-ratio:${sceneSize.width} / ${sceneSize.height}"` : "";
  const bdmvConfig = externalPlayback ? `<script defer src="runtime/bdmv-config.js"></script>` : "";
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${safeTitle}</title><link rel="stylesheet" href="runtime/style.css">${bdmvConfig}<script defer src="runtime/disc-data.js"></script>${assets}<script defer src="runtime/app.bundle.js"></script>`;
  const stage = `<div id="menu-stage"${aspectRatio}><video id="menu-background" aria-hidden="true" playsinline></video><audio id="menu-audio"></audio><canvas id="menu-canvas" aria-label="Blu-ray menu preview"></canvas><canvas id="popup-canvas" aria-label="Blu-ray popup menu" hidden></canvas></div>`;
  return `<!doctype html>\n<html lang="en"><head>${head}</head><body><main>${stage}<button id="start-menu" type="button" hidden>Start menu preview</button><button id="audio-mute-toggle" class="audio-mute-toggle" type="button" aria-label="Mute menu audio" aria-pressed="false" title="Mute menu audio"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="sound-on" d="M11 5 6 9H3v6h3l5 4V5Zm4 4a5 5 0 0 1 0 6"/><path class="sound-off" d="M11 5 6 9H3v6h3l5 4V5Zm4 4 5 6m0-6-5 6"/></svg></button><p id="runtime-status" role="status" aria-live="polite" class="is-visible"><span id="runtime-status-message">Loading menu preview…</span><button id="runtime-status-copy" type="button" aria-label="Copy status message" title="Copy status message" data-copied="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="copy-outline" d="M9 9h10v12H9z"/><path class="copy-outline" d="M13 9V4H4v13h1"/><path class="copied-mark" d="m5 12 4 4 10-10"/></svg></button></p><pre id="runtime-diagnostics" hidden></pre></main></body></html>\n`;
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
  /** Menu media encoder settings: codec, quality, and HDR policy. Defaults to HEVC / CRF 24 / veryfast / tonemap. */
  mediaEncoding?: MenuMediaEncoding;
  /** Local media for always-on menu playlists other than Top Menu. */
  additionalMenuMedia?: MenuLoopMediaInput[];
  onMediaProgress?: (progress: MediaAssetProgress) => void;
  /** Announces each assembly phase so a caller can report progress: media export, file writes, runtime bundle, manifest. */
  onPhase?: (phase: "media" | "assets" | "bundle" | "manifest") => void;
  /** Previous package directory used as the source for media-plan-matched assets on overwrite. */
  reuseMediaFromDirectory?: string;
  pngLimits?: { maxAssetBytes?: number; maxBatchBytes?: number; maxTotalBytes?: number };
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
  const serializedPgsTracks = (input.pgsTracks ?? []).map(serializePgsTrack);
  const pgsPayloadBytes = Buffer.byteLength(serializeSafeScriptData(serializedPgsTracks));
  const maxPgsRuntimeBytes = input.pgsLimits?.maxRuntimeBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maxPgsRuntimeBytes) || maxPgsRuntimeBytes <= 0) throw new RangeError("maxPgsRuntimeBytes must be a positive safe integer.");
  if (pgsPayloadBytes > maxPgsRuntimeBytes) throw new RangeError(`Serialized PGS payload exceeds maxPgsRuntimeBytes (${pgsPayloadBytes} > ${maxPgsRuntimeBytes} bytes).`);
  const output = resolve(input.outputDirectory); const runtimeDirectory = resolve(output, "runtime");
  await mkdir(runtimeDirectory, { recursive: true });
  input.onPhase?.("media");
  const mediaEncoding = input.mediaEncoding ?? {};
  const exportedMedia = input.menuLoopMedia ? await exportMenuLoopMedia(input.menuLoopMedia, { outputDirectory: output, ...mediaEncoding, ...(input.reuseMediaFromDirectory ? { reuseFromDirectory: input.reuseMediaFromDirectory } : {}), ...(input.onMediaProgress ? { onProgress: input.onMediaProgress } : {}) }) : undefined;
  const additionalMedia: Array<{ result: Awaited<ReturnType<typeof exportMenuLoopMedia>>; sanitizedId: string }> = [];
  for (const media of input.additionalMenuMedia ?? []) {
    // A menu playlist can own several PlayItems (sub-menus reached with LinkPI),
    // so the asset directory and plan must carry the PlayItem or they overwrite
    // each other. Paths use the sanitized id; the manifest must reference the
    // same sanitized paths that were written.
    const sanitizedId = `${media.playlistId}-pi${media.playItemIndex}`.replace(/[^0-9A-Za-z._-]/g, "_");
    additionalMedia.push({ sanitizedId, result: await exportMenuLoopMedia(media, {
      outputDirectory: output,
      ...mediaEncoding,
      assetDirectory: `assets/media/playlist-${sanitizedId}`,
      planPath: `media-plans/playlist-${sanitizedId}.json`,
      ...(input.reuseMediaFromDirectory ? { reuseFromDirectory: input.reuseMediaFromDirectory } : {}),
      ...(input.onMediaProgress ? { onProgress: input.onMediaProgress } : {}),
    }) });
  }
  // Colour-pipeline warnings describe a complete export; record them once in the
  // manifest so the report shows why HDR media keeps non-SDR signalling.
  for (const warning of [exportedMedia?.warnings ?? [], ...additionalMedia.map(({ result }) => result.warnings)].flat()) {
    if (!diagnostics.some((entry) => entry.code === warning.code)) diagnostics.push({ code: warning.code, message: warning.message, severity: "warning" });
  }
  const runtimeMenuMedia = additionalMedia.map(({ result }) => ({
    playlist: Number(result.plan.playlistId),
    playItem: result.plan.playItemIndex,
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
    ...(exportedMedia ? [{ path: "media-plan.json", kind: "media-plan", required: true }] : []),
    ...additionalMedia.map(({ sanitizedId }) => ({ path: `media-plans/playlist-${sanitizedId}.json`, kind: "media-plan", required: true })),
    ...(input.externalTargets ? [{ path: "runtime/bdmv-config.js", kind: "external-config", required: true }, { path: "external-targets.json", kind: "runtime", required: true }] : []),
  ];
  input.onPhase?.("assets");
  await Promise.all([
    writeFile(resolve(output, "index.html"), createMenuIndexHtml(input.title, batches.length, sceneSize, !!input.externalTargets)),
    writeFile(resolve(runtimeDirectory, "disc-data.js"), createDataScript({ ir, title: input.title, scene: input.scene, ...(input.popupScenes?.length ? { popupScenes: input.popupScenes } : {}), ...(input.menuScenes?.length ? { menuScenes: input.menuScenes } : {}), ...(input.menuPlaylistIds?.length ? { menuPlaylistIds: input.menuPlaylistIds } : {}), ...(input.menuPlaylistMarks?.length ? { menuPlaylistMarks: input.menuPlaylistMarks } : {}), ...(input.preMenuPlaylistIds?.length ? { preMenuPlaylistIds: input.preMenuPlaylistIds } : {}), ...(serializedPgsTracks.length ? { pgsTracks: serializedPgsTracks } : {}), vmPrograms: input.vmPrograms ?? [], ...(input.playerProfile ? { profile: input.playerProfile } : {}), ...(input.vmLimits ? { limits: input.vmLimits } : {}), ...(input.externalTargets ? { externalTargets: input.externalTargets } : {}), ...(input.vmEntries ? { vmEntries: input.vmEntries } : {}), ...(input.vmInitialProgramId !== undefined ? { vmInitialProgramId: input.vmInitialProgramId } : {}), ...(input.vmFirstPlayProgramId !== undefined ? { vmFirstPlayProgramId: input.vmFirstPlayProgramId } : {}), inputConfig: { escapeMapping: input.inputConfig?.escapeMapping ?? "popup" }, sounds: Object.fromEntries(sounds.map(({ index, path }) => [index, path])), ...(exportedMedia ? { media: { playlist: Number(input.menuLoopMedia!.playlistId), playItem: exportedMedia.plan.playItemIndex, background: { path: exportedMedia.background.path, durationSeconds: exportedMedia.background.durationSeconds, loop: exportedMedia.background.loop }, audioTracks: exportedMedia.audioTracks.map(runtimeAudioTrackMetadata) } } : {}), ...(runtimeMenuMedia.length ? { menuMedia: runtimeMenuMedia } : {}) })),
    ...(input.externalTargets ? [writeFile(resolve(runtimeDirectory, "bdmv-config.js"), `globalThis.__BDMV_BDMV_PATH__=${serializeSafeScriptData(input.bdmvPath ?? "../BDMV")};\n`)] : []),
    writeFile(resolve(runtimeDirectory, "style.css"), MENU_STYLE),
    writeFile(resolve(output, "README.md"), createReadme(input.title, exportedMedia?.background.loop, !!input.externalTargets, metadata.status) + (input.externalTargets ? "\nThe menu runs First Play initialization and then enters Top Menu. IINA 1.4.4 or later receives the selected chapter position through `mpv_start`; Windows opens the selected M2TS in PotPlayer.\n" : "")),
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
  const manifest = { schemaVersion: "1.0", status: metadata.status, ...(input.entryCounts ? { declaredEntryCount: input.entryCounts.declared, hdmvEntryCount: input.entryCounts.hdmv } : {}), files: manifestFiles, diagnostics: metadata.diagnostics, ...(input.playerProfile ? { profile: input.playerProfile } : {}), assets: { sounds, ...(exportedMedia ? { media: packagedMediaMetadata(exportedMedia) } : {}), ...(additionalMedia.length ? { menuMedia: additionalMedia.map(({ result }) => packagedMediaMetadata(result)) } : {}), pgsTracks: pgsManifest }, limitations: [menuMediaLimitation, "IGS effect sequences are rendered and presented; effect flag semantics beyond the synthetic fixtures remain unverified"] };
  await writeFile(resolve(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  // Media warnings are only known after encoding, so the caller gets them back
  // instead of the status, which stays decided by pre-packaging facts.
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

const MENU_STYLE = `:root{color-scheme:dark;font:16px system-ui,-apple-system,"Segoe UI",sans-serif;background:#000;color:#eee}
html,body{height:100%;margin:0;overflow:hidden;background:#000;overscroll-behavior:none;-webkit-text-size-adjust:100%}
main{position:fixed;inset:0}
#menu-stage{position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;overflow:hidden;background:#000;cursor:default;-webkit-user-select:none;user-select:none}
#menu-background,#menu-canvas,#popup-canvas{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:contain}
#menu-background{z-index:0}
#menu-audio{display:none}
#menu-canvas{z-index:1;background:transparent;touch-action:manipulation}
#popup-canvas{z-index:2;background:transparent;touch-action:manipulation}
#popup-canvas[hidden]{display:none}
#runtime-status{position:fixed;top:max(1rem,env(safe-area-inset-top));right:max(1rem,env(safe-area-inset-right));z-index:30;box-sizing:border-box;display:flex;gap:.6rem;align-items:flex-start;max-width:min(30rem,calc(100vw - 2rem));margin:0;padding:.55rem .85rem;border-radius:.6rem;background:rgba(18,18,22,.55);color:#f4f4f6;font-size:.85rem;line-height:1.35;text-align:left;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);opacity:0;transform:translateY(-.4rem);transition:opacity .4s ease,transform .4s ease;pointer-events:none}
#runtime-status.is-visible{opacity:1;transform:translateY(0)}
#runtime-status.is-error{background:rgba(96,20,26,.7);color:#ffe2df;border:1px solid rgba(255,140,130,.35)}
#runtime-status.is-persistent{pointer-events:auto;cursor:text;-webkit-user-select:text;user-select:text}
#runtime-status-message{flex:1 1 auto;min-width:0}
#runtime-status-copy{display:none;flex:0 0 auto;box-sizing:border-box;width:1.45rem;height:1.45rem;padding:.2rem;border:1px solid rgba(255,255,255,.24);border-radius:.35rem;background:rgba(255,255,255,.08);color:inherit;cursor:pointer;pointer-events:auto}
#runtime-status.is-visible #runtime-status-copy{display:grid;place-items:center}
#runtime-status-copy:hover{background:rgba(255,255,255,.2)}
#runtime-status-copy:focus-visible{outline:2px solid #7cc4ff;outline-offset:1px}
#runtime-status-copy svg{width:.95rem;height:.95rem;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
#runtime-status-copy .copied-mark{display:none}
#runtime-status-copy[data-copied="true"] .copied-mark{display:block}
#runtime-status-copy[data-copied="true"] .copy-outline{display:none}
#start-menu{position:fixed;left:50%;bottom:max(2rem,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:30;box-sizing:border-box;padding:.65rem 1.15rem;font:inherit;font-size:.95rem;color:#f4f4f6;background:rgba(18,18,22,.55);border:1px solid rgba(255,255,255,.22);border-radius:.6rem;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);cursor:pointer}
#start-menu:hover{background:rgba(32,32,38,.72)}
#start-menu:focus-visible{outline:2px solid #7cc4ff;outline-offset:2px}
#audio-mute-toggle{position:fixed;right:max(1.25rem,env(safe-area-inset-right));bottom:max(2rem,env(safe-area-inset-bottom));z-index:31;display:grid;place-items:center;width:2.8rem;height:2.8rem;padding:.55rem;border:1px solid rgba(255,255,255,.28);border-radius:50%;background:rgba(18,18,22,.46);color:#f4f4f6;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);cursor:pointer;transition:background .2s ease,opacity .2s ease}
#audio-mute-toggle:hover{background:rgba(32,32,38,.72)}
#audio-mute-toggle:focus-visible{outline:2px solid #7cc4ff;outline-offset:2px}
#audio-mute-toggle svg{width:1.4rem;height:1.4rem;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
#audio-mute-toggle .sound-off{display:none}
#audio-mute-toggle[aria-pressed="true"] .sound-on{display:none}
#audio-mute-toggle[aria-pressed="true"] .sound-off{display:block}
#runtime-diagnostics{position:fixed;left:max(1rem,env(safe-area-inset-left));right:max(1rem,env(safe-area-inset-right));bottom:max(1rem,env(safe-area-inset-bottom));z-index:40;box-sizing:border-box;max-height:40vh;margin:0;padding:.75rem .9rem;border-radius:.6rem;overflow:auto;background:rgba(10,10,12,.75);color:#ffb4a9;font:.8rem/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
`;
export function createReadme(title: string, backgroundLoops: boolean | undefined, externalPlayback: boolean, status: MenuPackageStatus = "partial"): string {
  const playbackNote = backgroundLoops === true
    ? "The detected menu playlist uses a repeated single-clip background loop with its declared primary audio tracks."
    : backgroundLoops === false
      ? "The detected menu playlist holds the final video frame after its single PlayItem; its declared primary audio tracks end with the PlayItem."
      : "No menu background media was exported.";
  return [
    `# ${title.replace(/[\r\n]/g, " ")}`,
    `Menu preview. Delivery status: **${status}**. ${playbackNote}`,
    "Run `bdmv2web validate <package-directory> --offline` to refresh `compatibility.json`, `dependency-audit.json`, and `reports/release-summary.json`.",
    externalPlayback ? "Open index.html in a browser while offline. Use the mute button at the lower right to control menu audio; external playback requests mute menu audio automatically, and the next key or click restores that automatic mute. A manual mute stays until the mute button is used again. Edit runtime/bdmv-config.js and reload to change the BDMV path. External playback uses IINA 1.4.4 or later on macOS and PotPlayer on Windows." : "Open index.html in a browser while offline. Use the mute button at the lower right to control menu audio.",
  ].join("\n\n") + "\n";
}

export function runtimeAudioTrackMetadata(track: { streamNumber?: number; path: string; language: string; durationSeconds?: number }): { streamNumber: number; psrStreamNumber: number; path: string; language: string; durationSeconds?: number } {
  if (!Number.isSafeInteger(track.streamNumber) || track.streamNumber! < 0) throw new TypeError("Exported audio track requires its zero-based STN streamNumber.");
  return { streamNumber: track.streamNumber!, psrStreamNumber: track.streamNumber! + 1, path: track.path, language: track.language, ...(track.durationSeconds === undefined ? {} : { durationSeconds: track.durationSeconds }) };
}

function serializePgsTrack(track: PgsTrackPackageInput) {
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
      imageBase64: encodePgsDisplayPng(set),
      placements: set.placements,
    })),
  };
}

function encodePgsDisplayPng(set: PgsDisplaySet): string {
  const rgba = new Uint8Array(set.width * set.height * 4);
  for (const placement of set.placements) {
    const bitmap = set.bitmaps.get(placement.objectId);
    if (!bitmap) continue;
    const crop = placement.crop ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
    for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) {
      const sourceX = crop.x + x, sourceY = crop.y + y;
      const targetX = placement.x + x, targetY = placement.y + y;
      if (sourceX >= bitmap.width || sourceY >= bitmap.height || targetX < 0 || targetY < 0 || targetX >= set.width || targetY >= set.height) continue;
      const sourceOffset = (sourceY * bitmap.width + sourceX) * 4;
      const targetOffset = (targetY * set.width + targetX) * 4;
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
  const scanlines = Buffer.alloc(set.height * (set.width * 4 + 1));
  for (let y = 0; y < set.height; y++) scanlines.set(rgba.subarray(y * set.width * 4, (y + 1) * set.width * 4), y * (set.width * 4 + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(set.width, 0); header.writeUInt32BE(set.height, 4); header[8] = 8; header[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(scanlines, { level: 9 })), pngChunk("IEND", Buffer.alloc(0))]);
  return png.toString("base64");
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const contents = Buffer.concat([typeBytes, data]);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0); contents.copy(chunk, 4); chunk.writeUInt32BE(pngCrc32(contents), data.length + 8);
  return chunk;
}

function pngCrc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function packagedMediaMetadata(media: Awaited<ReturnType<typeof exportMenuLoopMedia>>): Record<string, unknown> {
  return {
    plan: media.plan,
    background: { path: media.background.path, byteLength: media.background.byteLength, codec: media.background.codec, pid: media.background.pid, width: media.background.width, height: media.background.height, durationSeconds: media.background.durationSeconds, loop: media.background.loop },
    audioTracks: media.audioTracks.map((track) => ({ ...runtimeAudioTrackMetadata(track), byteLength: track.byteLength, codec: track.codec, pid: track.pid, durationSeconds: track.durationSeconds })),
  };
}

function escapeHtml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
