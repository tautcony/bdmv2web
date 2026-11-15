import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDiscIR, type SerializedScene, type RuntimeMenuSceneEntry } from "@bdmv2web/core";
import { exportMenuMedia, menuMediaPaths, priorMenuMediaPaths, type MenuLoopMediaResult, type PreparedMenuMedia } from "@bdmv2web/media-export";
import { makePngBatches } from "./asset-batches.js";
import { convertSounds } from "./sounds.js";
import { createAssetBatchScript, createDataScript, createMenuIndexHtml, createReadme, packagedStyle, serializeSafeScriptData } from "./scripts.js";
import type { MenuPackageInput, MenuPackageResult } from "./menu-package-input.js";
import type { MenuPackageMetadata } from "./types.js";
import { serializePgsTrack } from "./pgs-package.js";
import { packagedMediaMetadata, runtimeAudioTrackMetadata } from "./media-metadata.js";

/** Reports stay out of `manifest.files`; `asset-manifest.json` is a BD-J runtime index. */
const RESERVED_REPORT_FILES = new Set(["reports.json"]);

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
    externalDependencies: externalPlayback ? ["configured BDMV STREAM files", bdjRuntime ? "an operating-system file association for whole-file playback" : "an operating-system URL handler for declared BDMV STREAM targets"] : [],
  };
}

/**
 * Package-relative directory and plan file for one exported menu media unit.
 *
 * The BD-J and HDMV export paths both hand over the same unit — one Playlist
 * PlayItem read from one STREAM clip — so the name carries all three ids the
 * source files are named after: the playlist (`<playlistId>.mpls`), the
 * zero-based PlayItem, and the clip (`<clipId>.m2ts`). A folder therefore
 * points back at its source without opening the media plan.
 */
/** Media path naming comes from media-export; re-exported for package-builder importers. */
export { menuMediaPaths, priorMenuMediaPaths };

/**
 * Split menu scene entries into one shared table plus a per-PlayItem index.
 *
 * A menu playlist can name the same IGS composition from many PlayItems (this
 * disc's Top Menu resolves all 999 of its PlayItems to one clip), so the table
 * holds each composition once under its extracted id while entries keep every
 * other field and name their composition through `sceneId`.
 */
function shareMenuScenes(entries: NonNullable<MenuPackageInput["menuScenes"]>): { scenes: Record<string, SerializedScene>; menuScenes: RuntimeMenuSceneEntry[] } {
  const scenes: Record<string, SerializedScene> = {};
  const sceneIds = new Map<SerializedScene | string, string>();
  let anonymousCount = 0;
  const menuScenes: RuntimeMenuSceneEntry[] = entries.map(({ scene, ...entry }) => {
    const declaredId = scene.id;
    const identifiable = typeof declaredId === "string" && declaredId !== "";
    // Compositions without an extracted id are keyed by the object the caller
    // passed, so a caller that hands over one scene per PlayItem still gets one
    // copy as long as those PlayItems share that object.
    const key: SerializedScene | string = identifiable ? `declared:${declaredId}` : scene;
    const shared = sceneIds.get(key);
    if (shared !== undefined) return { ...entry, sceneId: shared };
    const sceneId = identifiable ? declaredId : `menu-scene-${anonymousCount++}`;
    sceneIds.set(key, sceneId);
    scenes[sceneId] = scene;
    return { ...entry, sceneId };
  });
  return { scenes, menuScenes };
}

/** Write a self-contained menu folder and bundle its browser entry as a classic IIFE. */
export async function assembleMenuPackage(input: MenuPackageInput & { preparedMedia: PreparedMenuMedia }): Promise<MenuPackageResult> {
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
  // Media arrives prepared by `exportMenuMedia()`; assembly writes the package files.
  const { primary, additional: additionalMedia } = input.preparedMedia;
  const primaryMedia = primary === undefined ? undefined : { planPath: primary.planPath };
  const exportedMedia: MenuLoopMediaResult | undefined = primary?.result;
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
  // Manifest media records are an index plus one record per exported plan: a
  // menu playlist can name the same media unit from hundreds of PlayItems, and a
  // full record per PlayItem put megabytes of identical plans into the manifest.
  const mediaPlans = new Map<string, ReturnType<typeof packagedMediaMetadata>>();
  const recordMediaPlan = (planPath: string, result: MenuLoopMediaResult): void => {
    if (!mediaPlans.has(planPath)) mediaPlans.set(planPath, packagedMediaMetadata(result));
  };
  if (exportedMedia && primaryMedia) recordMediaPlan(primaryMedia.planPath, exportedMedia);
  for (const { result, planPath } of additionalMedia) recordMediaPlan(planPath, result);
  const primaryPointer = input.menuLoopMedia && primaryMedia && exportedMedia ? { playlistId: input.menuLoopMedia.playlistId, playItemIndex: input.menuLoopMedia.playItemIndex, planPath: primaryMedia.planPath } : undefined;
  const menuMediaIndex = additionalMedia.map(({ input: media, planPath }) => ({ playlistId: media.playlistId, playItemIndex: media.playItemIndex, planPath }));
  const packagedPlans = Object.fromEntries(mediaPlans);
  const metadata: MenuPackageMetadata = { schemaVersion: "1.0", runtimeVersion: input.runtimeVersion ?? "0.1.0", title: input.title, status: input.status ?? "partial", diagnostics };
  const files: Array<{ path: string; kind: string; required?: boolean }> = [
    { path: "index.html", kind: "html", required: true },
    { path: "runtime/disc-data.js", kind: "runtime", required: true },
    { path: "runtime/style.css", kind: "runtime", required: true },
    { path: "README.md", kind: "readme", required: true },
    { path: "reports.json", kind: "report", required: true },
    { path: "runtime/app.bundle.js", kind: "runtime", required: true },
    ...(bdjRuntime ? [{ path: "runtime/bdj-client.js", kind: "runtime", required: true }] : []),
    ...batches.map((batch) => ({ path: `runtime/assets-data-${String(batch.index).padStart(3, "0")}.js`, kind: "runtime", required: true })),
    ...sounds.map((sound) => ({ path: sound.path, kind: "audio", required: true })),
    ...(exportedMedia?.files.map((file) => ({ path: file.path, kind: "media", required: true })) ?? []),
    ...additionalMedia.flatMap(({ result }) => result.files.map((file) => ({ path: file.path, kind: "media", required: true }))),
    ...[...new Set((input.pgsTracks ?? []).map((track) => track.path))].map((path) => ({ path, kind: "subtitle", required: true })),
    ...[...new Set([...(exportedMedia && primaryMedia ? [primaryMedia.planPath] : []), ...additionalMedia.map(({ planPath }) => planPath)])].map((path) => ({ path, kind: "media-plan", required: true })),
    ...(input.externalTargets ? [{ path: "runtime/bdmv-config.js", kind: "external-config", required: true }, { path: "external-targets.json", kind: "runtime", required: true }] : []),
    ...(bdjRuntime ? [{ path: "runtime/bdj/bdj-host-api.jar", kind: "bdj-host", required: true }, { path: "runtime/bdj/session.json", kind: "bdj-session", required: true }, { path: "asset-manifest.json", kind: "runtime-index", required: true }] : []),
    ...bdjFiles.map((file) => ({ path: `bdj/${file.path}`, kind: "bdj", required: true })),
  ];
  const sharedMenuScenes = input.menuScenes?.length ? shareMenuScenes(input.menuScenes) : undefined;
  input.onPhase?.("assets");
  await Promise.all([
    writeFile(resolve(output, "index.html"), createMenuIndexHtml(input.title, batches.length, sceneSize, !!input.externalTargets, bdjRuntime)),
    writeFile(resolve(runtimeDirectory, "disc-data.js"), createDataScript({ ir, title: input.title, scene: input.scene, ...(bdjRuntime ? { bdjRuntime: true, bdjFiles: bdjFiles.map(({ path }) => ({ path, packagePath: `bdj/${path}` })), bdjHostApiPath: "runtime/bdj/bdj-host-api.jar" } : {}), ...(input.popupScenes?.length ? { popupScenes: input.popupScenes } : {}), ...(sharedMenuScenes ? { scenes: sharedMenuScenes.scenes, menuScenes: sharedMenuScenes.menuScenes } : {}), ...(input.menuPlaylistIds?.length ? { menuPlaylistIds: input.menuPlaylistIds } : {}), ...(input.menuPlaylistMarks?.length ? { menuPlaylistMarks: input.menuPlaylistMarks } : {}), ...(input.preMenuPlaylistIds?.length ? { preMenuPlaylistIds: input.preMenuPlaylistIds } : {}), ...(serializedPgsTracks.length ? { pgsTracks: serializedPgsTracks } : {}), vmPrograms: input.vmPrograms ?? [], ...(input.playerProfile ? { profile: input.playerProfile } : {}), ...(input.vmLimits ? { limits: input.vmLimits } : {}), ...(input.externalTargets ? { externalTargets: input.externalTargets } : {}), ...(input.vmEntries ? { vmEntries: input.vmEntries } : {}), ...(input.vmInitialProgramId !== undefined ? { vmInitialProgramId: input.vmInitialProgramId } : {}), ...(input.vmFirstPlayProgramId !== undefined ? { vmFirstPlayProgramId: input.vmFirstPlayProgramId } : {}), inputConfig: { escapeMapping: input.inputConfig?.escapeMapping ?? "popup" }, sounds: Object.fromEntries(sounds.map(({ index, path }) => [index, path])), ...(exportedMedia ? { media: { playlist: Number(input.menuLoopMedia!.playlistId), playItem: exportedMedia.plan.playItemIndex, background: { path: exportedMedia.background.path, durationSeconds: exportedMedia.background.durationSeconds, loop: exportedMedia.background.loop, ...(exportedMedia.background.loopStartSeconds === undefined ? {} : { loopStartSeconds: exportedMedia.background.loopStartSeconds }) }, audioTracks: exportedMedia.audioTracks.map(runtimeAudioTrackMetadata) } } : {}), ...(runtimeMenuMedia.length ? { menuMedia: runtimeMenuMedia } : {}) })),
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
    writeFile(resolve(output, "asset-manifest.json"), `${JSON.stringify({ schemaVersion: "1.0", sounds, bdjFiles: bdjFiles.map(({ bytes, ...file }) => ({ ...file, packagePath: `bdj/${file.path}`, byteLength: String(bytes.byteLength) })), ...(primaryPointer ? { media: primaryPointer } : {}), ...(mediaPlans.size ? { mediaPlans: packagedPlans } : {}), ...(menuMediaIndex.length ? { menuMedia: menuMediaIndex } : {}), pgsTracks: (input.pgsTracks ?? []).map(({ displaySets: _displaySets, ...track }) => ({ ...track, displaySetCount: _displaySets.length })) }, null, 2)}\n`),
  ]);
  input.onPhase?.("bundle");
  await writeFile(resolve(runtimeDirectory, "app.bundle.js"), await readFile(menuRuntimeBundlePath()));
  if (bdjRuntime) await writeFile(resolve(runtimeDirectory, "bdj-client.js"), await readFile(bdjClientBundlePath()));
  input.onPhase?.("manifest");
  const compatibility = createCompatibility(metadata, !!input.externalTargets, bdjRuntime);
  const reportDiagnostics = compatibility.diagnostics;
  const compatibilityDetails = { ...compatibility };
  delete compatibilityDetails.diagnostics;
  delete compatibilityDetails.schemaVersion;
  await writeFile(resolve(output, "reports.json"), `${JSON.stringify({
    schemaVersion: "1.0",
    diagnostics: reportDiagnostics,
    compatibility: { ...compatibilityDetails, status: metadata.status },
  }, null, 2)}\n`);
  const manifestFiles = await Promise.all(files.filter((file) => !RESERVED_REPORT_FILES.has(file.path)).map(async (file) => {
    const fileInfo = await stat(resolve(output, file.path));
    return { ...file, byteLength: String(fileInfo.size) };
  }));
  manifestFiles.sort((a, b) => a.path.localeCompare(b.path, "en"));
  const menuMediaLimitation = input.externalTargets ? "External player handoff reports process launch requests; external players own playback state." : exportedMedia ? exportedMedia.background.loop ? "Menu background uses a repeated single-clip loop." : "Menu background holds its final frame after the single PlayItem; declared audio ends with the PlayItem." : "Menu background media is unavailable";
  const pgsManifest = (input.pgsTracks ?? []).map(({ displaySets, ...track }) => ({ ...track, displaySetCount: displaySets.length }));
  const manifest = { schemaVersion: "1.0", status: metadata.status, launchMode: bdjRuntime ? "local-jvm" : "hdmv", ...(bdjRuntime ? { runtimeRequirements: ["bdmv2web serve <package-directory>", "Java 21 or a compatible Java runtime with java.desktop", "loopback HTTP connection"] } : {}), ...(input.entryCounts ? { declaredEntryCount: input.entryCounts.declared, hdmvEntryCount: input.entryCounts.hdmv } : {}), files: manifestFiles, diagnostics: metadata.diagnostics, ...(input.playerProfile ? { profile: input.playerProfile } : {}), assets: { sounds, ...(primaryPointer ? { media: primaryPointer } : {}), ...(mediaPlans.size ? { mediaPlans: packagedPlans } : {}), ...(menuMediaIndex.length ? { menuMedia: menuMediaIndex } : {}), pgsTracks: pgsManifest }, limitations: [menuMediaLimitation, ...(bdjRuntime ? ["BD-J packages run through the local bdmv2web service and native Java process."] : []), "IGS effect sequences are rendered and presented; effect flag semantics are verified for the synthetic fixtures only"] };
  await writeFile(resolve(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { diagnostics: metadata.diagnostics };
}

/** Convert only M1-declared 48 kHz, signed 16-bit mono/stereo PCM sample ranges. BCLK words are big-endian. */
function getSceneSize(scene: unknown): { width: number; height: number } | undefined {
  if (scene === null) return undefined;
  if (typeof scene !== "object" || scene === null || !Number.isSafeInteger((scene as { width?: unknown }).width) || !Number.isSafeInteger((scene as { height?: unknown }).height) || (scene as { width: number }).width <= 0 || (scene as { height: number }).height <= 0) throw new TypeError("Menu scene must declare positive integer width and height");
  return { width: (scene as { width: number }).width, height: (scene as { height: number }).height };
}

/**
 * Compatibility entry: run media-export's `exportMenuMedia()`, then
 * `assembleMenuPackage()`. New callers use `planBuild()` and run both steps
 * through `buildUseCase()`.
 */
export async function buildMenuPackage(input: MenuPackageInput): Promise<MenuPackageResult> {
  input.onPhase?.("media");
  const preparedMedia = await exportMenuMedia(input.menuLoopMedia, input.additionalMenuMedia ?? [], {
    outputDirectory: input.outputDirectory,
    ...(input.mediaEncoding ? { mediaEncoding: input.mediaEncoding } : {}),
    ...(input.reuseMediaFromDirectory ? { reuseFromDirectory: input.reuseMediaFromDirectory } : {}),
    ...(input.mediaProcessRunner ? { runProcess: input.mediaProcessRunner } : {}),
    ...(input.onMediaProgress ? { onProgress: input.onMediaProgress } : {}),
  });
  return assembleMenuPackage({ ...input, preparedMedia });
}
