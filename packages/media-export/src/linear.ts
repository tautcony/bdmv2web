import { access, mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { SourceLocation } from "@bdmv2web/bdmv-parser";
import { assertActualWithinLimit, assertEstimateWithinLimit, estimateMenuLoopBudget, validateBudgetRates, validateOptionalByteLimit, type MenuLoopBudgetRates } from "./budget.js";
import type { MediaPlan as SourceMediaPlan, MediaPlanRequirement, PlannedTrack } from "./media-plan.js";
import { assertEncodedColor, planVideoColor, readSourceColor, videoEncoderArgs, videoEncoderName, type ColorProbeFields, type HdrMode, type OutputColor, type SourceColor, type VideoCodec, type VideoColorPlan } from "./color.js";

export interface LinearProcessResult { stdout: string; stderr: string; }
export type LinearProcessRunner = (executable: string, args: string[], timeoutMs: number, signal?: AbortSignal) => Promise<LinearProcessResult>;

export interface LinearMediaExportOptions {
  sourceRoot: string;
  outputDirectory: string;
  runProcess: LinearProcessRunner;
  ffmpegPath?: string;
  ffprobePath?: string;
  timeoutMs?: number;
  crf?: number;
  preset?: "medium" | "fast" | "veryfast" | "ultrafast";
  codec?: VideoCodec;
  hdrMode?: HdrMode;
  maxAssetBytes?: number | null;
  estimatedVideoBitsPerSecond?: number;
  estimatedAudioBitsPerSecond?: number;
  containerOverheadPercent?: number;
  signal?: AbortSignal;
}

export interface LinearDiagnostic { code: string; message: string; source: SourceLocation | null; }
export interface LinearPlayItemMapping {
  playItemIndex: number;
  /** One-based MPLS/STN primary-audio number for this lane; never inferred from language sort order. */
  primaryAudioStreamNumber: number;
  clipId: string;
  source: SourceLocation;
  sourceIn45k: number;
  sourceOut45k: number;
  playlistStart45k: string;
  playlistEnd45k: string;
}
export interface LinearAssetPlan {
  assetId: string;
  path: string;
  playlistId: string;
  routes: MediaPlanRequirement["routes"];
  audioLanguage: string;
  codec: "h264+aac" | "hevc+aac";
  repeat: false;
  aspectRatio: string;
  width: number;
  height: number;
  mappings: LinearPlayItemMapping[];
  duration45k: string;
  estimatedBytes: string;
}
export interface LinearMediaPlan {
  schemaVersion: "1.0";
  status: "partial";
  strategy: { branches: "one-linear-asset-per-playlist-and-audio-language"; menuBackground: "separate-looping-asset"; menuBackgroundPath: "assets/media/background.mp4"; sourceStreamsPackaged: false };
  encoding: {
    videoCodec: VideoCodec; audioCodec: "aac"; preset: string; crf: number; pixelFormat: string; frameRate: "passthrough"; faststart: true; aspectRatio: "preserve-per-playlist";
    color: { policy: HdrMode; source: SourceColor; output: OutputColor; filterChain: VideoColorPlan["filterChain"] };
  };
  budget: { rates: MenuLoopBudgetRates; estimateBasis: "configured-target-bitrate-assumption"; existingOutputBytes: string; maxAssetBytes: number | null };
  assets: LinearAssetPlan[];
  diagnostics: LinearDiagnostic[];
  limitations: string[];
}
export interface LinearExportedAsset extends LinearAssetPlan { absolutePath: string; byteLength: number; durationSeconds: number; }
export interface LinearMediaExportResult {
  plan: LinearMediaPlan;
  assets: LinearExportedAsset[];
  outputSize: { beforeBytes: string; afterBytes: string };
  tools: { ffmpeg: string; ffprobe: string; invocations: Array<{ executable: string; args: string[] }> };
}

interface ProbeStream extends ColorProbeFields { index?: number; id?: string; codec_type?: string; codec_name?: string; width?: number; height?: number; display_aspect_ratio?: string; sample_rate?: string; channels?: number; duration?: string; }
interface Probe { streams?: ProbeStream[]; format?: { start_time?: string; duration?: string }; }
interface ResolvedPlayItem { item: MediaPlanRequirement["playItems"][number]; sourcePath: string; probe: Probe; video: ProbeStream; audios: Map<string, ProbeStream | null>; startOffsetSeconds: number; aspectRatio: string; }
interface PendingAsset { plan: LinearAssetPlan; args: string[]; width: number; height: number; durationSeconds: number; codec: VideoCodec; color: VideoColorPlan; }

export class LinearMediaExportError extends Error {
  constructor(readonly diagnostic: { code: "MEDIA_JOB_CANCELLED" | "MEDIA_JOB_TIMEOUT" | "MEDIA_PROCESS_FAILED" | "MEDIA_OUTPUT_INVALID" | "MEDIA_ASSET_BUDGET_EXCEEDED"; message: string; executable?: string; args?: string[]; limitBytes?: string; actualBytes?: string }, options?: ErrorOptions) {
    super(diagnostic.message, options);
    this.name = "LinearMediaExportError";
  }
}

/** Build one linear file per reachable Playlist and audio-language lane. Distinct Playlists remain distinct assets. */
export async function exportLinearMedia(mediaPlan: SourceMediaPlan, options: LinearMediaExportOptions): Promise<LinearMediaExportResult> {
  validateOptions(options);
  const output = resolve(options.outputDirectory);
  const sourceRoot = resolve(options.sourceRoot);
  const ffmpeg = options.ffmpegPath ?? "ffmpeg";
  const ffprobe = options.ffprobePath ?? "ffprobe";
  const timeoutMs = options.timeoutMs ?? 20 * 60 * 1000;
  const crf = options.crf ?? ((options.codec ?? "hevc") === "hevc" ? 24 : 18);
  const preset = options.preset ?? "veryfast";
  const rates: MenuLoopBudgetRates = {
    estimatedVideoBitsPerSecond: options.estimatedVideoBitsPerSecond ?? mediaPlan.budget.estimatedVideoBitsPerSecond,
    estimatedAudioBitsPerSecond: options.estimatedAudioBitsPerSecond ?? mediaPlan.budget.estimatedAudioBitsPerSecond,
    containerOverheadPercent: options.containerOverheadPercent ?? mediaPlan.budget.containerOverheadPercent,
  };
  validateBudgetRates(rates);
  const planPath = resolve(output, "linear-media-plan.json");
  await ensureAbsent(planPath);
  const diagnostics: LinearDiagnostic[] = mediaPlan.diagnostics.map((item) => ({ ...item }));
  if (!mediaPlan.reachability.complete) diagnostics.push({ code: "MEDIA_REACHABILITY_INCOMPLETE", message: "Source media reachability is incomplete; this linear plan remains partial.", source: null });
  const invocations: Array<{ executable: string; args: string[] }> = [];
  const invoke = async (executable: string, args: string[], parentSignal?: AbortSignal): Promise<LinearProcessResult> => {
    if (options.signal?.aborted || parentSignal?.aborted) throw jobError("MEDIA_JOB_CANCELLED", executable, args, "Linear media export was cancelled before tool launch.");
    invocations.push({ executable, args: [...args] });
    const controller = new AbortController();
    let cancelled = false;
    let rejectCancelled: ((error: Error) => void) | undefined;
    const cancelledPromise = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
    const onAbort = () => { cancelled = true; controller.abort(); rejectCancelled?.(jobError("MEDIA_JOB_CANCELLED", executable, args, `Media job '${executable}' was cancelled.`)); };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    parentSignal?.addEventListener("abort", onAbort, { once: true });
    let rejectTimeout: ((error: Error) => void) | undefined;
    const deadline = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
    const process = options.runProcess(executable, args, timeoutMs, controller.signal);
    const timeout = setTimeout(() => {
      controller.abort();
      rejectTimeout?.(jobError("MEDIA_JOB_TIMEOUT", executable, args, `${executable} timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
    try { return await Promise.race([process, deadline, cancelledPromise]); }
    catch (error) {
      controller.abort();
      await process.catch(() => undefined);
      if (error instanceof LinearMediaExportError) throw error;
      if (cancelled) throw jobError("MEDIA_JOB_CANCELLED", executable, args, `Media job '${executable}' was cancelled.`);
      throw jobError("MEDIA_PROCESS_FAILED", executable, args, `${executable} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      parentSignal?.removeEventListener("abort", onAbort);
    }
  };

  const ffmpegVersion = firstLine((await invoke(ffmpeg, ["-version"])).stdout);
  const ffprobeVersion = firstLine((await invoke(ffprobe, ["-version"])).stdout);
  const codec = options.codec ?? "hevc";
  if (codec !== "h264" && codec !== "hevc") throw new RangeError(`codec must be 'h264' or 'hevc', received '${String(codec)}'`);
  const hdrMode: HdrMode = options.hdrMode ?? "tonemap";
  if (hdrMode !== "tonemap" && hdrMode !== "preserve") throw new RangeError(`hdrMode must be 'tonemap' or 'preserve', received '${String(hdrMode)}'`);
  const encoderArgs = ["-hide_banner", "-encoders"];
  const encoders = await invoke(ffmpeg, encoderArgs);
  const encoderText = `${encoders.stdout}\n${encoders.stderr}`;
  const missingEncoders = [videoEncoderName(codec), "aac"].filter((name) => !hasEncoder(encoderText, name));
  if (missingEncoders.length) throw new LinearMediaExportError({ code: "MEDIA_PROCESS_FAILED", executable: ffmpeg, args: encoderArgs, message: `Required encoder${missingEncoders.length > 1 ? "s" : ""} unavailable: ${missingEncoders.join(", ")}.` });
  const filterArgs = ["-hide_banner", "-filters"];
  const filterList = await invoke(ffmpeg, filterArgs);
  const filterText = `${filterList.stdout}\n${filterList.stderr}`;
  const colorOptions = { policy: hdrMode, codec, hasZscale: hasFilter(filterText, "zscale") };

  const requirements = mediaPlan.requirements;
  const sourceProbes = new Map<string, Probe>();
  const pendingAssets: PendingAsset[] = [];
  for (const requirement of requirements) {
    const resolved = await resolvePlayItems(requirement, sourceRoot, ffprobe, timeoutMs, invoke, sourceProbes, diagnostics);
    if (resolved.length !== requirement.playItems.length || requirement.playItems.length === 0) continue;
    const variants = audioVariantKeys(requirement, diagnostics);
    for (const language of variants) {
      const lanes = resolved.map((entry) => entry.audios.get(language));
      if (lanes.some((track) => !track || !Number.isSafeInteger(track.index))) {
        diagnostics.push({ code: "MEDIA_AUDIO_VARIANT_INCOMPLETE", message: `Playlist '${requirement.playlistId}' has no unambiguous '${language}' audio lane across every PlayItem; no incomplete asset was emitted.`, source: requirement.playlistSource });
        continue;
      }
      const first = resolved[0]!;
      const incompatible = resolved.find((entry) => !sameAspectRatio(first.aspectRatio, entry.aspectRatio)
        || entry.video.width !== first.video.width || entry.video.height !== first.video.height
        || !positiveInteger(Number(lanes[resolved.indexOf(entry)]!.sample_rate))
        || !positiveInteger(Number(lanes[resolved.indexOf(entry)]!.channels))
        || lanes[resolved.indexOf(entry)]!.sample_rate !== lanes[0]!.sample_rate
        || lanes[resolved.indexOf(entry)]!.channels !== lanes[0]!.channels);
      if (incompatible) {
        diagnostics.push({ code: "MEDIA_LINEAR_FORMAT_MISMATCH", message: `Playlist '${requirement.playlistId}' PlayItem ${incompatible.item.index} has video or audio parameters incompatible with the linear concat profile; no asset was emitted.`, source: incompatible.item.source });
        continue;
      }
      const pending = makeLinearAsset(requirement, resolved, lanes as ProbeStream[], language, output, { codec, crf, preset, colorOptions }, rates);
      pendingAssets.push(pending);
    }
  }

  const excludedSources = new Set(requirements.flatMap((requirement) => requirement.playItems.map((item) => resolve(sourceRoot, item.streamFile.path))));
  const existingOutputBytes = await directoryBytes(output, excludedSources);
  const planColor = pendingAssets[0]?.color ?? planVideoColor(readSourceColor({}), colorOptions);
  const linearEncoding = { codec, crf, preset, color: planColor };
  for (const asset of pendingAssets) assertEstimateWithinLimit({ scope: "asset", estimateBytes: BigInt(asset.plan.estimatedBytes), limitBytes: options.maxAssetBytes, message: `Estimated linear asset '${asset.plan.path}' exceeds maxAssetBytes.` });
  await mkdir(resolve(output, "assets/media"), { recursive: true });

  const created: string[] = [];
  const exported: LinearExportedAsset[] = [];
  try {
    for (const asset of pendingAssets) {
      const absolutePath = resolve(output, asset.plan.path);
      await ensureAbsent(absolutePath);
      created.push(absolutePath);
      await runWithBudget(ffmpeg, asset.args, asset.plan.path, absolutePath, options, invoke);
      const outputProbe = await probeOutput(ffprobe, absolutePath, timeoutMs, invoke);
      const measured = validateOutput(outputProbe, asset);
      const bytes = (await stat(absolutePath)).size;
      exported.push({ ...asset.plan, absolutePath, byteLength: bytes, ...measured });
    }
    const plan = makeLinearPlan(mediaPlan, exported, diagnostics, rates, existingOutputBytes, options, linearEncoding);
    const manifest = `${JSON.stringify(plan, null, 2)}\n`;
    created.push(planPath);
    await writeFile(planPath, manifest, { flag: "wx" });
    const actualOutputBytes = await directoryBytes(output, excludedSources);
    const outputSize = { beforeBytes: existingOutputBytes.toString(), afterBytes: actualOutputBytes.toString() };
    return { plan, assets: exported, outputSize, tools: { ffmpeg: ffmpegVersion, ffprobe: ffprobeVersion, invocations } };
  } catch (error) {
    await Promise.all(created.map((path) => unlink(path).catch(() => undefined)));
    throw error;
  }
}

function validateOptions(options: LinearMediaExportOptions): void {
  if (!options.sourceRoot || !options.outputDirectory) throw new TypeError("sourceRoot and outputDirectory are required");
  if (typeof options.runProcess !== "function") throw new TypeError("runProcess is required");
  const timeoutMs = options.timeoutMs ?? 20 * 60 * 1000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RangeError("timeoutMs must be a positive safe integer");
  const crf = options.crf ?? 18;
  if (!Number.isInteger(crf) || crf < 0 || crf > 51) throw new RangeError("crf must be from 0 through 51");
  validateOptionalByteLimit("maxAssetBytes", options.maxAssetBytes);
}

async function resolvePlayItems(requirement: MediaPlanRequirement, sourceRoot: string, ffprobe: string, timeoutMs: number, invoke: (executable: string, args: string[]) => Promise<LinearProcessResult>, cache: Map<string, Probe>, diagnostics: LinearDiagnostic[]): Promise<ResolvedPlayItem[]> {
  const resolved: ResolvedPlayItem[] = [];
  for (const item of requirement.playItems) {
    const video = item.tracks.filter((track) => track.role === "video");
    const audio = item.tracks.filter((track) => track.role === "audio");
    for (const track of item.tracks.filter((candidate) => candidate.role === "unknown" || candidate.role === "subtitle")) diagnostics.push({ code: track.role === "subtitle" ? "MEDIA_SUBTITLE_UNSUPPORTED" : "MEDIA_TRACK_ROLE_UNKNOWN", message: `Playlist '${requirement.playlistId}' PlayItem ${item.index} retains unsupported ${track.role} track PID ${track.pid ?? "unknown"}.`, source: track.source });
    if (item.strategy.status === "partial") for (const reason of item.strategy.reasons) diagnostics.push({ code: "MEDIA_PLAY_ITEM_PARTIAL", message: `Playlist '${requirement.playlistId}' PlayItem ${item.index}: ${reason}`, source: item.source });
    if (!item.streamFile.present) { diagnostics.push({ code: "MEDIA_STREAM_FILE_MISSING", message: `Required clip '${item.clipId}' is marked absent; no linear asset was emitted.`, source: item.streamFile.source ?? item.source }); continue; }
    if (video.length !== 1 || video[0]!.pid === null) { diagnostics.push({ code: "MEDIA_VIDEO_PID_UNRESOLVED", message: `Playlist '${requirement.playlistId}' PlayItem ${item.index} requires exactly one resolved video PID.`, source: item.source }); continue; }
    if (item.angle.multiAngle || item.angle.angleCount > 1 || item.angle.seamlessAngle) { diagnostics.push({ code: "MEDIA_ANGLE_UNSUPPORTED", message: `Playlist '${requirement.playlistId}' PlayItem ${item.index} has unresolved angle behavior.`, source: item.source }); continue; }
    if (item.sourceOut45k <= item.sourceIn45k) { diagnostics.push({ code: "MEDIA_INVALID_INTERVAL", message: `Playlist '${requirement.playlistId}' PlayItem ${item.index} has a non-positive interval.`, source: item.source }); continue; }
    const sourcePath = resolve(sourceRoot, item.streamFile.path);
    try { await access(sourcePath); }
    catch { diagnostics.push({ code: "MEDIA_STREAM_FILE_MISSING", message: `Required clip '${item.clipId}' is not readable at its planned source path.`, source: item.streamFile.source ?? item.source }); continue; }
    let probe = cache.get(sourcePath);
    if (!probe) {
      const result = await invoke(ffprobe, probeArgs(sourcePath));
      probe = parseProbe(result.stdout, sourcePath);
      cache.set(sourcePath, probe);
    }
    const sourceStart = Number(probe.format?.start_time);
    if (!Number.isFinite(sourceStart)) { diagnostics.push({ code: "MEDIA_SOURCE_START_UNKNOWN", message: `FFprobe has no finite start_time for clip '${item.clipId}'.`, source: item.source }); continue; }
    const videoStream = probe.streams?.find((stream) => stream.codec_type === "video" && streamPid(stream.id) === video[0]!.pid);
    if (!videoStream || !Number.isSafeInteger(videoStream.index) || !validDimension(videoStream.width) || !validDimension(videoStream.height)) { diagnostics.push({ code: "MEDIA_VIDEO_STREAM_UNVERIFIED", message: `FFprobe did not identify an indexed video PID ${video[0]!.pid} for clip '${item.clipId}'.`, source: item.source }); continue; }
    const audioStreams = new Map<string, ProbeStream | null>();
    for (const track of audio) {
      if (track.pid === null) continue;
      const stream = probe.streams?.find((candidate) => candidate.codec_type === "audio" && streamPid(candidate.id) === track.pid);
      if (!stream || !Number.isSafeInteger(stream.index)) { diagnostics.push({ code: "MEDIA_AUDIO_STREAM_UNVERIFIED", message: `FFprobe did not identify an indexed audio PID ${track.pid} for clip '${item.clipId}'.`, source: track.source }); continue; }
      const key = variantKey(track, audio.length);
      if (key) audioStreams.set(key, audioStreams.has(key) ? null : stream);
    }
    let ratio: string;
    try { ratio = aspectRatio(videoStream); }
    catch { diagnostics.push({ code: "MEDIA_VIDEO_ASPECT_UNKNOWN", message: `FFprobe did not report a usable display aspect ratio for clip '${item.clipId}'.`, source: item.source }); continue; }
    resolved.push({ item, sourcePath, probe, video: videoStream, audios: audioStreams, startOffsetSeconds: Math.max(0, item.sourceIn45k / 45_000 - sourceStart), aspectRatio: ratio });
  }
  if (requirement.subPaths.some((subPath) => subPath.items.length > 0)) diagnostics.push({ code: "MEDIA_SUBPATH_UNSUPPORTED", message: `Playlist '${requirement.playlistId}' has SubPath items that remain unsupported and are not folded into the linear asset.`, source: requirement.playlistSource });
  return resolved;
}

function audioVariantKeys(requirement: MediaPlanRequirement, diagnostics: LinearDiagnostic[]): string[] {
  const languages = new Set<string>();
  for (const item of requirement.playItems) {
    const tracks = item.tracks.filter((track) => track.role === "audio");
    if (tracks.some((track) => track.language === null) && tracks.length > 1) diagnostics.push({ code: "MEDIA_AUDIO_VARIANT_UNKNOWN", message: `Playlist '${requirement.playlistId}' PlayItem ${item.index} has multiple audio PIDs without language labels; audio lane identity is ambiguous.`, source: item.source });
    for (const track of tracks) {
      const key = variantKey(track, tracks.length);
      if (key) languages.add(key);
    }
  }
  if (languages.size === 0 && requirement.playItems.length > 0) diagnostics.push({ code: "MEDIA_AUDIO_VARIANT_MISSING", message: `Playlist '${requirement.playlistId}' has no unambiguous audio language lane; no H.264/AAC linear asset can be emitted.`, source: requirement.playlistSource });
  return [...languages].sort();
}

/** Resolve a language lane to its explicit one-based position in the PlayItem audio declaration order. */
export function primaryAudioStreamNumberForLanguage(tracks: readonly PlannedTrack[], language: string): number | null {
  const audio = tracks.filter((track) => track.role === "audio");
  const matches = audio.flatMap((track, index) => variantKey(track, audio.length) === language.toLowerCase() ? [index + 1] : []);
  return matches.length === 1 ? matches[0]! : null;
}

function variantKey(track: PlannedTrack, audioCount: number): string | null {
  if (track.language) return track.language.toLowerCase();
  return audioCount === 1 ? "und" : null;
}

function makeLinearAsset(requirement: MediaPlanRequirement, items: ResolvedPlayItem[], audio: ProbeStream[], language: string, output: string, encoding: { codec: VideoCodec; crf: number; preset: string; colorOptions: { policy: HdrMode; codec: VideoCodec; hasZscale: boolean } }, rates: MenuLoopBudgetRates): PendingAsset {
  const color = planVideoColor(readSourceColor(items[0]!.video), encoding.colorOptions);
  const inputPixelFormat = color.output.bitDepth === 10 ? "yuv420p10le" : "yuv420p";
  const total45k = items.reduce((sum, entry) => sum + BigInt(entry.item.sourceOut45k - entry.item.sourceIn45k), 0n);
  const estimate = estimateMenuLoopBudget(Number(total45k), 1, rates);
  const playlistPart = pathPart(requirement.playlistId);
  const languagePart = pathPart(language);
  const assetId = `playlist-${playlistPart}-audio-${languagePart}`;
  const path = `assets/media/${assetId}.mp4`;
  const mappings: LinearPlayItemMapping[] = [];
  let timelineStart = 0n;
  const filterParts: string[] = [];
  const concatInputs: string[] = [];
  const args: string[] = ["-hide_banner", "-nostdin", "-loglevel", "error", "-n"];
  for (const [index, entry] of items.entries()) {
    args.push("-ss", seconds(entry.startOffsetSeconds), "-i", entry.sourcePath);
    const duration45k = BigInt(entry.item.sourceOut45k - entry.item.sourceIn45k);
    const duration = seconds(Number(duration45k) / 45_000);
    const videoIndex = entry.video.index;
    const audioIndex = audio[index]!.index;
    filterParts.push(`[${index}:${videoIndex}]trim=duration=${duration},setpts=PTS-STARTPTS,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=${inputPixelFormat}[v${index}]`);
    filterParts.push(`[${index}:${audioIndex}]atrim=duration=${duration},asetpts=PTS-STARTPTS[a${index}]`);
    concatInputs.push(`[v${index}][a${index}]`);
    const primaryAudioStreamNumber = primaryAudioStreamNumberForLanguage(entry.item.tracks, language);
    if (primaryAudioStreamNumber === null) throw new Error(`Playlist '${requirement.playlistId}' PlayItem ${entry.item.index} has no unique primary-audio stream for '${language}'.`);
    mappings.push({ playItemIndex: entry.item.index, primaryAudioStreamNumber, clipId: entry.item.clipId, source: entry.item.source, sourceIn45k: entry.item.sourceIn45k, sourceOut45k: entry.item.sourceOut45k, playlistStart45k: timelineStart.toString(), playlistEnd45k: (timelineStart + duration45k).toString() });
    timelineStart += duration45k;
  }
  filterParts.push(`${concatInputs.join("")}concat=n=${items.length}:v=1:a=1[outv][outa]`);
  filterParts.push(`[outv]${color.videoFilter}[vout]`);
  args.push("-filter_complex", filterParts.join(";"), "-map", "[vout]", "-map", "[outa]", ...videoEncoderArgs(color, encoding.codec, encoding.crf, encoding.preset), "-aspect", items[0]!.aspectRatio, "-fps_mode", "passthrough", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-f", "mp4", resolve(output, path));
  const plan: LinearAssetPlan = { assetId, path, playlistId: requirement.playlistId, routes: requirement.routes, audioLanguage: language, codec: `${encoding.codec}+aac`, repeat: false, aspectRatio: items[0]!.aspectRatio, width: items[0]!.video.width!, height: items[0]!.video.height!, mappings, duration45k: timelineStart.toString(), estimatedBytes: estimate.totalMediaBytes };
  return { plan, args, width: items[0]!.video.width!, height: items[0]!.video.height!, durationSeconds: Number(timelineStart) / 45_000, codec: encoding.codec, color };
}

function makeLinearPlan(source: SourceMediaPlan, assets: readonly LinearAssetPlan[], diagnostics: LinearDiagnostic[], rates: MenuLoopBudgetRates, existingOutputBytes: bigint, options: LinearMediaExportOptions, encoding: { codec: VideoCodec; crf: number; preset: string; color: VideoColorPlan }): LinearMediaPlan {
  const plan: LinearMediaPlan = {
    schemaVersion: "1.0", status: "partial",
    strategy: { branches: "one-linear-asset-per-playlist-and-audio-language", menuBackground: "separate-looping-asset", menuBackgroundPath: "assets/media/background.mp4", sourceStreamsPackaged: false },
    encoding: {
      videoCodec: encoding.codec, audioCodec: "aac", preset: encoding.preset, crf: encoding.crf,
      pixelFormat: `yuv420p${encoding.color.output.bitDepth === 10 ? "10le" : ""}`, frameRate: "passthrough", faststart: true, aspectRatio: "preserve-per-playlist",
      color: { policy: encoding.color.policy, source: encoding.color.source, output: encoding.color.output, filterChain: encoding.color.filterChain },
    },
    budget: { rates, estimateBasis: "configured-target-bitrate-assumption", existingOutputBytes: existingOutputBytes.toString(), maxAssetBytes: options.maxAssetBytes ?? null },
    assets: assets.map(({ assetId, path, playlistId, routes, audioLanguage, codec, repeat, aspectRatio, width, height, mappings, duration45k, estimatedBytes }) => ({ assetId, path, playlistId, routes, audioLanguage, codec, repeat, aspectRatio, width, height, mappings, duration45k, estimatedBytes })), diagnostics: [...diagnostics],
    limitations: [
      "Each reachable Playlist is encoded as its own asset.",
      "The looping menu background remains the independent background.mp4 asset produced by the menu-loop export path.",
      "Playback assets are the per-Playlist exports. Persistent source-stream references stay unpackaged; STREAM M2TS files are transcode inputs.",
      ...(!source.reachability.complete ? ["Emitted assets cover the parsed PlayItem sequences; reachability is incomplete and the status remains partial."] : []),
    ],
  };
  return plan;
}

async function runWithBudget(ffmpeg: string, args: string[], relativePath: string, assetPath: string, options: LinearMediaExportOptions, invoke: (executable: string, args: string[], signal?: AbortSignal) => Promise<LinearProcessResult>): Promise<void> {
  const controller = new AbortController();
  const process = invoke(ffmpeg, args, controller.signal);
  let checkingAsset = false;
  let rejectBudget: ((error: Error) => void) | undefined;
  const budget = new Promise<never>((_resolve, reject) => { rejectBudget = reject; });
  const failBudget = (error: unknown) => { controller.abort(); rejectBudget?.(error instanceof Error ? error : new Error(String(error))); };
  const checkAsset = async () => {
    if (checkingAsset) return;
    checkingAsset = true;
    try {
      const assetBytes = await fileBytes(assetPath);
      assertActualWithinLimit({ scope: "asset", actualBytes: assetBytes, limitBytes: options.maxAssetBytes, message: `Linear asset '${relativePath}' exceeded maxAssetBytes while encoding.` });
    } catch (error) { failBudget(error); }
    finally { checkingAsset = false; }
  };
  const assetTimer = setInterval(() => { void checkAsset(); }, 10);
  void checkAsset();
  try {
    await Promise.race([process, budget]);
    assertActualWithinLimit({ scope: "asset", actualBytes: await fileBytes(assetPath), limitBytes: options.maxAssetBytes, message: `Linear asset '${relativePath}' exceeded maxAssetBytes at process completion.` });
  } catch (error) {
    controller.abort();
    await process.catch(() => undefined);
    if (error instanceof Error && "diagnostic" in error) throw error;
    if (error instanceof Error) throw error;
    throw new Error(String(error), { cause: error });
  } finally { clearInterval(assetTimer); }
}

async function probeOutput(ffprobe: string, path: string, timeoutMs: number, invoke: (executable: string, args: string[]) => Promise<LinearProcessResult>): Promise<Probe> {
  const args = probeArgs(path);
  const response = await invoke(ffprobe, args);
  try { return parseProbe(response.stdout, path); }
  catch (error) { throw jobError("MEDIA_OUTPUT_INVALID", ffprobe, args, `FFprobe returned invalid metadata for encoded output: ${error instanceof Error ? error.message : String(error)}`); }
}

function validateOutput(probe: Probe, asset: PendingAsset): { width: number; height: number; durationSeconds: number } {
  try {
    const videos = probe.streams?.filter((stream) => stream.codec_type === "video") ?? [];
    const audios = probe.streams?.filter((stream) => stream.codec_type === "audio") ?? [];
    if (videos.length !== 1 || audios.length !== 1) throw new Error(`expected one video and one audio stream; found ${videos.length} and ${audios.length}`);
    const video = videos[0]!;
    assertEncodedColor(video, asset.color, asset.codec, asset.plan.path);
    if (!validDimension(video.width) || !validDimension(video.height) || video.width % 2 !== 0 || video.height % 2 !== 0) throw new Error("even dimensions failed verification");
    if (audios[0]!.codec_name !== "aac") throw new Error("audio codec is not AAC");
    const duration = Number(video.duration ?? probe.format?.duration);
    if (!Number.isFinite(duration) || Math.abs(duration - asset.durationSeconds) > 0.25) throw new Error(`encoded duration ${duration} differs from planned ${asset.durationSeconds}`);
    const audioDuration = Number(audios[0]!.duration ?? probe.format?.duration);
    if (!Number.isFinite(audioDuration) || Math.abs(audioDuration - asset.durationSeconds) > 0.25) throw new Error(`encoded audio duration ${audioDuration} differs from planned ${asset.durationSeconds}`);
    if (video.width !== asset.width || video.height !== asset.height) throw new Error("encoded dimensions differ from planned common dimensions");
    return { width: video.width, height: video.height, durationSeconds: duration };
  } catch (error) { throw new LinearMediaExportError({ code: "MEDIA_OUTPUT_INVALID", message: `Encoded asset '${asset.plan.path}' failed FFprobe validation: ${error instanceof Error ? error.message : "invalid metadata"}` }, { cause: error }); }
}

function parseProbe(text: string, subject: string): Probe {
  try { const value = JSON.parse(text) as Probe; if (!Array.isArray(value.streams)) throw new Error("no streams array"); return value; }
  catch (error) { throw new Error(`invalid ffprobe JSON for '${subject}': ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
}
function probeArgs(path: string): string[] { return ["-v", "error", "-show_entries", "stream=index,id,codec_type,codec_name,width,height,display_aspect_ratio,sample_rate,channels,duration,pix_fmt,color_range,color_space,color_transfer,color_primaries,bits_per_raw_sample:stream_side_data=side_data_type:format=start_time,duration", "-of", "json", path]; }
function streamPid(id: string | undefined): number | null { if (!id) return null; return /^0x[0-9a-f]+$/i.test(id) ? Number.parseInt(id.slice(2), 16) : /^\d+$/.test(id) ? Number(id) : null; }
function aspectRatio(stream: ProbeStream): string { if (stream.display_aspect_ratio && /^\d+:\d+$/.test(stream.display_aspect_ratio)) return stream.display_aspect_ratio; if (!validDimension(stream.width) || !validDimension(stream.height)) throw new Error("source aspect ratio is unknown"); const divisor = gcd(stream.width, stream.height); return `${stream.width / divisor}:${stream.height / divisor}`; }
function sameAspectRatio(left: string, right: string): boolean { const [lw, lh] = left.split(":").map(Number); const [rw, rh] = right.split(":").map(Number); return lw! * rh! === rw! * lh!; }
function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }
function validDimension(value: number | undefined): value is number { return Number.isSafeInteger(value) && value! > 0; }
function positiveInteger(value: number): boolean { return Number.isSafeInteger(value) && value > 0; }
function hasEncoder(text: string, name: string): boolean { return text.split(/\r?\n/).some((line) => /^\s*[VAS.D]{6}\s+/.test(line) && line.trim().split(/\s+/, 2)[1] === name); }
function hasFilter(text: string, name: string): boolean { return text.split(/\r?\n/).some((line) => /^\s*[TSC.]{2,3}\s+/.test(line) && line.trim().split(/\s+/, 2)[1] === name); }
function firstLine(text: string): string { return text.split(/\r?\n/, 1)[0] || "unknown"; }
function seconds(value: number): string { return value.toFixed(9).replace(/0+$/, "").replace(/\.$/, ""); }
function pathPart(value: string): string { return basename(value).replace(/[^a-zA-Z0-9._-]/g, "-") || "unknown"; }
function jobError(code: "MEDIA_JOB_CANCELLED" | "MEDIA_JOB_TIMEOUT" | "MEDIA_PROCESS_FAILED" | "MEDIA_OUTPUT_INVALID", executable: string, args: string[], message: string): LinearMediaExportError { return new LinearMediaExportError({ code, executable, args: [...args], message }); }

async function fileBytes(path: string): Promise<bigint> { try { return BigInt((await stat(path)).size); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0n; throw error; } }
async function directoryBytes(root: string, excluded: Set<string>): Promise<bigint> {
  let total = 0n;
  const visit = async (directory: string): Promise<void> => {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (excluded.has(path) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) total += BigInt((await stat(path)).size);
    }
  };
  await visit(root);
  return total;
}
async function ensureAbsent(path: string): Promise<void> { try { await access(path); throw new Error(`Output target already exists: '${path}'.`); } catch (error) { if (error instanceof Error && error.message.startsWith("Output target already exists:")) throw error; if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
