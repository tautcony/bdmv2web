import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDiscIR, type DiscIR, type Limits, type PlayerProfile } from "@bdmv2web/core";
import type { VmOptions, VmProgram } from "@bdmv2web/hdmv";
import { exportMenuLoopMedia, type ExternalMediaTargets, type HdrMode, type MediaAssetProgress, type MediaProcessResult, type MediaProcessRunner, type MenuLoopMediaInput, type MenuLoopMediaResult, type VideoCodec, type VideoExportMode,  } from "@bdmv2web/media-export";
import { makePngBatches, type PngPayload } from "./asset-batches.js";
import { convertSounds, type SoundMetadata } from "./sounds.js";
import { createAssetBatchScript, createDataScript, createMenuIndexHtml, createReadme, packagedStyle, serializeSafeScriptData } from "./scripts.js";
import type { MenuPackageDiagnostic, MenuPackageMetadata, MenuPackageStatus } from "./types.js";
import { serializePgsTrack, type PgsTrackPackageInput } from "./pgs-package.js";
import { packagedMediaMetadata, runtimeAudioTrackMetadata } from "./media-metadata.js";

export { serializePgsTrack, type PgsTrackPackageInput } from "./pgs-package.js";
export { packagedMediaMetadata, runtimeAudioTrackMetadata } from "./media-metadata.js";
export { makePngBatches, type PngBatch, type PngPayload } from "./asset-batches.js";
export { convertSounds, type SoundMetadata, type SoundPayload } from "./sounds.js";
export { createAssetBatchScript, createDataScript, createMenuIndexHtml, createReadme, serializeSafeScriptData } from "./scripts.js";
export { type MenuPackageDiagnostic, type MenuPackageMetadata, type MenuPackageStatus } from "./types.js";

const RESERVED_REPORT_FILES = new Set(["compatibility.json", "asset-manifest.json"]);

export interface BdjPackageFile { path: string; sourcePath: string; bytes: Uint8Array }


/** The published CLI carries the menu bundle beside its entry; a workspace build reads the runtime-web export. */
function menuRuntimeBundlePath(): string {
  const besideEntry = fileURLToPath(new URL("runtime/app.bundle.js", import.meta.url));
  return existsSync(besideEntry) ? besideEntry : createRequire(import.meta.url).resolve("@bdmv2web/runtime-web/browser-bundle");
}

function bdjClientBundlePath(): string {
  const besideEntry = fileURLToPath(new URL("runtime/bdj-client.bundle.js", import.meta.url));
  return existsSync(besideEntry) ? besideEntry : createRequire(import.meta.url).resolve("@bdmv2web/runtime-web/bdj-client-bundle");
}

export function createCompatibility(metadata: MenuPackageMetadata, externalPlayback = false, bdjRuntime = false): Record<string, unknown> {
  return {
    ...metadata,
    profile: "portable",
    coverage: { igs: "unverified" },
    externalDependencies: externalPlayback ? ["configured BDMV STREAM files", bdjRuntime ? "an operating-system file association for whole-file playback" : "an operating-system URL handler for declared BDMV STREAM targets"] : [],
    notVerified: ["package directory relocation", "real-disc rendering", "media timeline and seek accuracy"],
  };
}

/** Menu media encoder settings forwarded to every menu media export. */
export interface MenuMediaEncoding {
  crf?: number;
  preset?: "medium" | "fast" | "veryfast" | "ultrafast";
  codec?: VideoCodec;
  hdrMode?: HdrMode;
  /** `copy` remuxes the source H.264 stream instead of re-encoding it; see `exportMenuLoopMedia`. */
  videoMode?: VideoExportMode;
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
  /** BD-J application JARs and authored resources mapped into the Java virtual filesystem. */
  bdjFiles?: BdjPackageFile[];
  /** Native Java startup record for the packaged BDJO applications. */
  bdjLaunch?: { discId: string; initialBdjoId: string; applications: Array<{ bdjoId: string; controlCode: number; binding: number; organizationId: number; applicationId: number; initialClass: string; basePath: string; classPath: string; parameters: string[] }>; session?: { vmPrograms: VmProgram[]; vmEntries: VmOptions["entries"]; playerProfile: PlayerProfile; vmLimits: Limits; externalTargets?: ExternalMediaTargets; bdmvPath?: string; bdjoDescriptors?: unknown[] } };
  /** Compiled BD-J host bytes copied into this package's runtime directory. */
  bdjHostApiJar?: Uint8Array;
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

/**
 * Package-relative directory and plan file for one exported menu media unit.
 *
 * The BD-J and HDMV export paths both hand over the same unit — one Playlist
 * PlayItem read from one STREAM clip — so the name carries all three ids the
 * source files are named after: the playlist (`<playlistId>.mpls`), the
 * zero-based PlayItem, and the clip (`<clipId>.m2ts`). A folder therefore
 * points back at its source without opening the media plan.
 */
export function menuMediaPaths(input: Pick<MenuLoopMediaInput, "playlistId" | "playItemIndex" | "clipId">): { directory: string; planPath: string } {
  const id = `playlist-${input.playlistId}-pi${String(input.playItemIndex).padStart(2, "0")}-clip-${input.clipId}`.replace(/[^0-9A-Za-z._-]/g, "_");
  return { directory: `assets/media/${id}`, planPath: `media-plans/${id}.json` };
}

/**
 * Where earlier versions stored the same unit: one folder per playlist
 * PlayItem (`playlist-<id>-pi<n>`, no clip in the name), and the Top Menu
 * background at the media root. Reuse tries these after the current names, so
 * a package or unfinished staging directory from an older run still resumes
 * instead of re-encoding every clip.
 */
export function priorMenuMediaPaths(input: Pick<MenuLoopMediaInput, "playlistId" | "playItemIndex">): Array<{ assetDirectory: string; planPath: string }> {
  const id = `playlist-${input.playlistId}-pi${input.playItemIndex}`.replace(/[^0-9A-Za-z._-]/g, "_");
  return [
    { assetDirectory: `assets/media/${id}`, planPath: `media-plans/${id}.json` },
    { assetDirectory: "assets/media", planPath: "media-plan.json" },
  ];
}

/** Write a self-contained menu folder and bundle its browser entry as a classic IIFE. */
export async function buildMenuPackage(input: MenuPackageInput): Promise<MenuPackageResult> {
  const ir = parseDiscIR(input.ir);
  const bdjFiles = input.bdjFiles ?? [];
  const bdjRuntime = bdjFiles.length > 0;
  if (bdjRuntime && (!input.bdjLaunch || !input.bdjLaunch.applications.length || !input.bdjHostApiJar?.byteLength)) throw new TypeError("BD-J packages require native Java launch data, application files, and a compiled host JAR.");
  const bdjFilePaths = new Set<string>();
  for (const file of bdjFiles) {
    const segments = file.path.split("/");
    if (!file.path.startsWith("BDMV/JAR/") || segments.some((segment) => segment === "" || segment === "." || segment === "..")) throw new TypeError(`BD-J package file path '${file.path}' must remain under BDMV/JAR.`);
    const key = file.path.toLocaleLowerCase("en-US");
    if (bdjFilePaths.has(key)) throw new TypeError(`Duplicate BD-J package file path '${file.path}'.`);
    bdjFilePaths.add(key);
  }
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
  if (bdjRuntime) await mkdir(resolve(runtimeDirectory, "bdj"), { recursive: true });
  input.onPhase?.("media");
  const mediaEncoding = input.mediaEncoding ?? {};
  const sourceProbeCache = new Map<string, Promise<MediaProcessResult>>();
  const primaryMedia = input.menuLoopMedia === undefined ? undefined : menuMediaPaths(input.menuLoopMedia);
  const exportedMedia = input.menuLoopMedia && primaryMedia ? await exportMenuLoopMedia(input.menuLoopMedia, { outputDirectory: output, ...mediaEncoding, sourceProbeCache, assetDirectory: primaryMedia.directory, planPath: primaryMedia.planPath, ...(input.reuseMediaFromDirectory ? { reuseFromDirectory: input.reuseMediaFromDirectory, reuseAlternatives: priorMenuMediaPaths(input.menuLoopMedia) } : {}), ...(input.mediaProcessRunner ? { runProcess: input.mediaProcessRunner } : {}), ...(input.onMediaProgress ? { onProgress: input.onMediaProgress } : {}) }) : undefined;
  const mediaByKey = new Map<string, { result: MenuLoopMediaResult; planPath: string }>();
  if (input.menuLoopMedia && exportedMedia && primaryMedia) mediaByKey.set(menuMediaReuseKey(input.menuLoopMedia, mediaEncoding), { result: exportedMedia, planPath: primaryMedia.planPath });
  const additionalMedia: Array<{ input: MenuLoopMediaInput; result: MenuLoopMediaResult; planPath: string }> = [];
  for (const media of input.additionalMenuMedia ?? []) {
    const key = menuMediaReuseKey(media, mediaEncoding);
    const existing = mediaByKey.get(key);
    if (existing) {
      // The clip shares its bytes with one already exported: nothing is encoded,
      // but it keeps a PlayItem-specific plan for future reuse.
      input.onMediaProgress?.({ state: "end", outTimeSeconds: existing.result.background.durationSeconds, durationSeconds: existing.result.background.durationSeconds, assetPath: existing.result.background.path, source: { playlistId: media.playlistId, playItemIndex: media.playItemIndex, clipId: media.clipId, kind: "background", pid: media.videoPid, videoMode: existing.result.plan.encoding.video.mode, reused: true } });
      const { planPath } = menuMediaPaths(media);
      const result = referenceMenuMediaResult(existing.result, media);
      await mkdir(resolve(output, dirname(planPath)), { recursive: true });
      await writeFile(resolve(output, planPath), `${JSON.stringify(result.plan, null, 2)}\n`);
      additionalMedia.push({ input: media, result, planPath });
      continue;
    }
    const { directory, planPath } = menuMediaPaths(media);
    const result = await exportMenuLoopMedia(media, {
      outputDirectory: output,
      ...mediaEncoding,
      sourceProbeCache,
      assetDirectory: directory,
      planPath,
      ...(input.reuseMediaFromDirectory ? { reuseFromDirectory: input.reuseMediaFromDirectory, reuseAlternatives: priorMenuMediaPaths(media) } : {}),
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
    background: { path: result.background.path, durationSeconds: result.background.durationSeconds, loop: result.background.loop, ...(result.background.loopStartSeconds === undefined ? {} : { loopStartSeconds: result.background.loopStartSeconds }) },
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
    ...(bdjRuntime ? [{ path: "runtime/bdj-client.js", kind: "runtime", required: true }] : []),
    ...batches.map((batch) => ({ path: `runtime/assets-data-${String(batch.index).padStart(3, "0")}.js`, kind: "runtime", required: true })),
    ...sounds.map((sound) => ({ path: sound.path, kind: "audio", required: true })),
    ...(exportedMedia?.files.map((file) => ({ path: file.path, kind: "media", required: true })) ?? []),
    ...additionalMedia.flatMap(({ result }) => result.files.map((file) => ({ path: file.path, kind: "media", required: true }))),
    ...[...new Set((input.pgsTracks ?? []).map((track) => track.path))].map((path) => ({ path, kind: "subtitle", required: true })),
    ...[...new Set([...(exportedMedia && primaryMedia ? [primaryMedia.planPath] : []), ...additionalMedia.map(({ planPath }) => planPath)])].map((path) => ({ path, kind: "media-plan", required: true })),
    ...(input.externalTargets ? [{ path: "runtime/bdmv-config.js", kind: "external-config", required: true }, { path: "external-targets.json", kind: "runtime", required: true }] : []),
    ...(bdjRuntime ? [{ path: "runtime/bdj/bdj-host-api.jar", kind: "bdj-host", required: true }, { path: "runtime/bdj/session.json", kind: "bdj-session", required: true }] : []),
    ...bdjFiles.map((file) => ({ path: `bdj/${file.path}`, kind: "bdj", required: true })),
  ];
  input.onPhase?.("assets");
  await Promise.all([
    writeFile(resolve(output, "index.html"), createMenuIndexHtml(input.title, batches.length, sceneSize, !!input.externalTargets, bdjRuntime)),
    writeFile(resolve(runtimeDirectory, "disc-data.js"), createDataScript({ ir, title: input.title, scene: input.scene, ...(bdjRuntime ? { bdjRuntime: true, bdjFiles: bdjFiles.map(({ path }) => ({ path, packagePath: `bdj/${path}` })), bdjHostApiPath: "runtime/bdj/bdj-host-api.jar" } : {}), ...(input.popupScenes?.length ? { popupScenes: input.popupScenes } : {}), ...(input.menuScenes?.length ? { menuScenes: input.menuScenes } : {}), ...(input.menuPlaylistIds?.length ? { menuPlaylistIds: input.menuPlaylistIds } : {}), ...(input.menuPlaylistMarks?.length ? { menuPlaylistMarks: input.menuPlaylistMarks } : {}), ...(input.preMenuPlaylistIds?.length ? { preMenuPlaylistIds: input.preMenuPlaylistIds } : {}), ...(serializedPgsTracks.length ? { pgsTracks: serializedPgsTracks } : {}), vmPrograms: input.vmPrograms ?? [], ...(input.playerProfile ? { profile: input.playerProfile } : {}), ...(input.vmLimits ? { limits: input.vmLimits } : {}), ...(input.externalTargets ? { externalTargets: input.externalTargets } : {}), ...(input.vmEntries ? { vmEntries: input.vmEntries } : {}), ...(input.vmInitialProgramId !== undefined ? { vmInitialProgramId: input.vmInitialProgramId } : {}), ...(input.vmFirstPlayProgramId !== undefined ? { vmFirstPlayProgramId: input.vmFirstPlayProgramId } : {}), inputConfig: { escapeMapping: input.inputConfig?.escapeMapping ?? "popup" }, sounds: Object.fromEntries(sounds.map(({ index, path }) => [index, path])), ...(exportedMedia ? { media: { playlist: Number(input.menuLoopMedia!.playlistId), playItem: exportedMedia.plan.playItemIndex, background: { path: exportedMedia.background.path, durationSeconds: exportedMedia.background.durationSeconds, loop: exportedMedia.background.loop, ...(exportedMedia.background.loopStartSeconds === undefined ? {} : { loopStartSeconds: exportedMedia.background.loopStartSeconds }) }, audioTracks: exportedMedia.audioTracks.map(runtimeAudioTrackMetadata) } } : {}), ...(runtimeMenuMedia.length ? { menuMedia: runtimeMenuMedia } : {}) })),
    ...(input.externalTargets ? [writeFile(resolve(runtimeDirectory, "bdmv-config.js"), `globalThis.__BDMV_BDMV_PATH__=${serializeSafeScriptData(input.bdmvPath ?? "../BDMV")};\n`)] : []),
    ...bdjFiles.map(async (file) => {
      const target = resolve(output, "bdj", file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.bytes);
    }),
    ...(bdjRuntime ? [writeFile(resolve(runtimeDirectory, "bdj/bdj-host-api.jar"), input.bdjHostApiJar!)] : []),
    ...(bdjRuntime ? [writeFile(resolve(runtimeDirectory, "bdj/session.json"), `${JSON.stringify(input.bdjLaunch)}\n`)] : []),
    writeFile(resolve(runtimeDirectory, "style.css"), packagedStyle()),
    writeFile(resolve(output, "README.md"), createReadme(input.title, exportedMedia?.background.loop, !!input.externalTargets, metadata.status, bdjRuntime)),
    ...(input.externalTargets ? [writeFile(resolve(output, "external-targets.json"), `${JSON.stringify(input.externalTargets)}\n`)] : []),
    ...batches.map((batch) => writeFile(resolve(runtimeDirectory, `assets-data-${String(batch.index).padStart(3, "0")}.js`), createAssetBatchScript(batch))),
    ...soundResult.files.map(async ({ path, bytes }) => { await mkdir(resolve(output, "assets/audio"), { recursive: true }); await writeFile(resolve(output, path), bytes); }),
    writeFile(resolve(output, "asset-manifest.json"), `${JSON.stringify({ schemaVersion: "1.0", sounds, bdjFiles: bdjFiles.map(({ bytes, ...file }) => ({ ...file, packagePath: `bdj/${file.path}`, byteLength: String(bytes.byteLength) })), ...(exportedMedia ? { media: packagedMediaMetadata(exportedMedia) } : {}), ...(additionalMedia.length ? { menuMedia: additionalMedia.map(({ result }) => packagedMediaMetadata(result)) } : {}), pgsTracks: (input.pgsTracks ?? []).map(({ displaySets: _displaySets, ...track }) => ({ ...track, displaySetCount: _displaySets.length })) }, null, 2)}\n`),
  ]);
  input.onPhase?.("bundle");
  await writeFile(resolve(runtimeDirectory, "app.bundle.js"), await readFile(menuRuntimeBundlePath()));
  if (bdjRuntime) await writeFile(resolve(runtimeDirectory, "bdj-client.js"), await readFile(bdjClientBundlePath()));
  input.onPhase?.("manifest");
  await writeFile(resolve(output, "compatibility.json"), `${JSON.stringify(createCompatibility(metadata, !!input.externalTargets, bdjRuntime), null, 2)}\n`);
  const manifestFiles = await Promise.all(files.filter((file) => !RESERVED_REPORT_FILES.has(file.path)).map(async (file) => {
    const fileInfo = await stat(resolve(output, file.path));
    return { ...file, byteLength: String(fileInfo.size) };
  }));
  manifestFiles.sort((a, b) => a.path.localeCompare(b.path, "en"));
  const menuMediaLimitation = input.externalTargets ? "External player handoff reports process launch requests; external players own playback state." : exportedMedia ? exportedMedia.background.loop ? "Menu background uses a repeated single-clip loop." : "Menu background holds its final frame after the single PlayItem; declared audio ends with the PlayItem." : "Menu background media is unavailable";
  const pgsManifest = (input.pgsTracks ?? []).map(({ displaySets, ...track }) => ({ ...track, displaySetCount: displaySets.length }));
  const manifest = { schemaVersion: "1.0", status: metadata.status, launchMode: bdjRuntime ? "local-jvm" : "hdmv", ...(bdjRuntime ? { runtimeRequirements: ["bdmv2web serve <package-directory>", "Java 21 or a compatible Java runtime with java.desktop", "loopback HTTP connection"] } : {}), ...(input.entryCounts ? { declaredEntryCount: input.entryCounts.declared, hdmvEntryCount: input.entryCounts.hdmv } : {}), files: manifestFiles, diagnostics: metadata.diagnostics, ...(input.playerProfile ? { profile: input.playerProfile } : {}), assets: { sounds, ...(exportedMedia ? { media: packagedMediaMetadata(exportedMedia) } : {}), ...(additionalMedia.length ? { menuMedia: additionalMedia.map(({ result }) => packagedMediaMetadata(result)) } : {}), pgsTracks: pgsManifest }, limitations: [menuMediaLimitation, ...(bdjRuntime ? ["BD-J packages run through the local bdmv2web service and native Java process."] : []), "IGS effect sequences are rendered and presented; effect flag semantics are verified for the synthetic fixtures only"] };
  await writeFile(resolve(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { diagnostics: metadata.diagnostics };
}

/** Convert only M1-declared 48 kHz, signed 16-bit mono/stereo PCM sample ranges. BCLK words are big-endian. */
function getSceneSize(scene: unknown): { width: number; height: number } | undefined {
  if (scene === null) return undefined;
  if (typeof scene !== "object" || scene === null || !Number.isSafeInteger((scene as { width?: unknown }).width) || !Number.isSafeInteger((scene as { height?: unknown }).height) || (scene as { width: number }).width <= 0 || (scene as { height: number }).height <= 0) throw new TypeError("Menu scene must declare positive integer width and height");
  return { width: (scene as { width: number }).width, height: (scene as { height: number }).height };
}


function menuMediaReuseKey(media: MenuLoopMediaInput, encoding: MenuMediaEncoding): string {
  const codec = encoding.codec ?? (encoding.videoMode === "copy" ? "h264" : "hevc");
  return JSON.stringify({
    sourcePath: resolve(media.sourcePath),
    sourceFile: media.sourceFile,
    clipId: media.clipId,
    inTime45k: media.inTime45k,
    loopStart45k: media.loopStart45k ?? null,
    includeIntro: media.includeIntro ?? false,
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
      videoMode: encoding.videoMode ?? "encode",
    },
  });
}

function referenceMenuMediaResult(media: MenuLoopMediaResult, input: MenuLoopMediaInput): MenuLoopMediaResult {
  return {
    ...media,
    plan: {
      ...media.plan,
      playlistId: input.playlistId,
      playItemIndex: input.playItemIndex,
      assetPaths: { background: media.background.path, audioTracks: media.audioTracks.map((track) => track.path) },
    },
    tools: { ffmpeg: "reused", ffprobe: "reused", invocations: [] },
    files: [],
  };
}
