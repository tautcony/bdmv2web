import { spawn } from "node:child_process";
import { access, copyFile, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { M2tsPacketReader, PesAssembler } from "@bdmv2web/igs";
import { directoryBytesExcluding } from "./directory-bytes.js";
import { parsePgsSup } from "./pgs.js";
import { assertActualWithinLimit, assertEstimateWithinLimit, estimateMenuLoopBudget, validateBudgetRates, validateOptionalByteLimit, type MenuLoopBudgetEstimate, type MenuLoopBudgetRates } from "./budget.js";
import { assertEncodedColor, planVideoColor, readSourceColor, videoEncoderArgs, videoEncoderName, type ColorProbeFields, type ColorWarning, type ColorFilterChain, type HdrMode, type OutputColor, type SourceColor, type VideoCodec, type VideoColorPlan } from "./color.js";

export * from "./closure.js";
export * from "./external-targets.js";
export * from "./media-plan.js";
export * from "./timeline.js";
export * from "./seek.js";
export * from "./linear.js";
export * from "./budget.js";
export * from "./color.js";
export * from "./pgs.js";
export * from "./pgs-render.js";

export interface ExtractedPgsTrack { pid: number; sourcePath: string; path: string; byteLength: number; displaySets: ReturnType<typeof parsePgsSup>; }

/** Extract one declared Blu-ray PGS PID as SUP, then parse and validate every display set. */
export async function extractPgsTrack(sourcePath: string, pid: number, outputPath: string, options: { maxBytes?: number; timestampOffset90k?: bigint } = {}): Promise<ExtractedPgsTrack> {
  if (!Number.isSafeInteger(pid) || pid < 0x20 || pid > 0x1ffe) throw new RangeError("PGS PID must be a valid 13-bit transport PID.");
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError("maxBytes must be a positive safe integer.");
  const timestampOffset90k = options.timestampOffset90k ?? 0n;
  if (timestampOffset90k < 0n) throw new RangeError("timestampOffset90k must be non-negative.");
  const output = resolve(outputPath);
  await mkdir(resolve(output, ".."), { recursive: true });
  try {
    const reader = new M2tsPacketReader("pgs-extraction");
    const assembler = new PesAssembler("pgs-extraction");
    const segments: Uint8Array[] = [];
    let byteLength = 0;
    let effectiveTimestampOffset90k = timestampOffset90k;
    let hasTimestampAnchor = false;
    let hasDtsAnchor = false;
    const accept = (pesPackets: ReturnType<PesAssembler["push"]>) => {
      for (const pes of pesPackets) {
        if (!hasTimestampAnchor) {
          hasTimestampAnchor = true;
          const pts = pes.pts?.raw;
          // The reference SUP timestamp convention anchors a PGS stream near
          // the source interval to its first DTS, then keeps all later deltas.
          if (pts !== undefined && pes.dtsRaw !== null && pts > timestampOffset90k && pts - timestampOffset90k <= 180_000n) effectiveTimestampOffset90k = pes.dtsRaw;
        }
        let offset = 0;
        while (offset < pes.payload.length) {
          if (offset + 3 > pes.payload.length) throw new TypeError(`PGS PID ${pid} contains a truncated PES segment header.`);
          const length = (pes.payload[offset + 1]! << 8) | pes.payload[offset + 2]!;
          const end = offset + 3 + length;
          if (end > pes.payload.length) throw new TypeError(`PGS PID ${pid} contains a truncated PES segment payload.`);
          const pts = Number(((pes.pts?.raw ?? 0n) - effectiveTimestampOffset90k) & 0xffff_ffffn);
          const dts = pes.dtsRaw !== null
            ? Number((pes.dtsRaw - effectiveTimestampOffset90k) & 0xffff_ffffn)
            : hasDtsAnchor ? Number(((pes.pts?.raw ?? 0n) - effectiveTimestampOffset90k) & 0xffff_ffffn) : 0;
          if (pes.dtsRaw !== null) hasDtsAnchor = true;
          const record = new Uint8Array(13 + length);
          record.set([0x50, 0x47, pts >>> 24, pts >>> 16, pts >>> 8, pts, dts >>> 24, dts >>> 16, dts >>> 8, dts], 0);
          record.set(pes.payload.subarray(offset, end), 10);
          segments.push(record); byteLength += record.byteLength;
          if (byteLength > maxBytes) throw new RangeError(`Extracted PGS PID ${pid} exceeds maxBytes.`);
          offset = end;
        }
      }
    };
    for await (const chunk of createReadStream(resolve(sourcePath), { highWaterMark: 256 * 1024 }) as AsyncIterable<Uint8Array>) {
      for (const packet of reader.feed(chunk)) if (packet.pid === pid) accept(assembler.push(packet));
    }
    reader.end();
    accept(assembler.end());
    const transportError = reader.diagnostics.find((item) => item.source?.pid === pid && item.severity === "error");
    const pesError = assembler.diagnostics.find((item) => item.source?.pid === pid && item.severity === "error");
    if (transportError) throw new TypeError(`PGS PID ${pid} transport stream is invalid: ${transportError.message}`);
    if (pesError) throw new TypeError(`PGS PID ${pid} PES stream is invalid: ${pesError.message}`);
    const bytes = concatBytes(segments, byteLength);
    const displaySets = parsePgsSup(bytes);
    if (displaySets.length === 0) throw new TypeError(`Extracted PGS PID ${pid} contains no complete display sets.`);
    await writeFile(output, bytes);
    return { pid, sourcePath: resolve(sourcePath), path: output, byteLength: bytes.byteLength, displaySets };
  } catch (error) {
    await unlink(output).catch(() => undefined);
    throw error;
  }
}

function concatBytes(chunks: readonly Uint8Array[], byteLength: number): Uint8Array {
  const output = new Uint8Array(byteLength); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

export interface MediaAudioTrackInput { streamNumber: number; pid: number; language: string; }
export interface MenuLoopMediaInput {
  sourcePath: string;
  sourceFile: string;
  playlistId: string;
  playItemIndex: number;
  clipId: string;
  inTime45k: number;
  /** Optional nonzero source mark used as the repeated menu segment's start. */
  loopStart45k?: number;
  /** Encode the initial presentation from inTime45k before entering the loop segment. */
  includeIntro?: boolean;
  outTime45k: number;
  stillMode: number;
  repeatCount: number;
  /** Whether the declared menu segment repeats; ordinary single PlayItems play once. */
  loopBackground?: boolean;
  videoPid: number;
  audioTracks: MediaAudioTrackInput[];
}
export interface MediaProcessResult { stdout: string; stderr: string; }
export interface MediaProcessProgress { outTimeSeconds: number; state: "continue" | "end"; }
/** The menu clip and stream whose encoding an asset progress report describes. */
export interface MediaAssetSource {
  playlistId: string;
  playItemIndex: number;
  clipId: string;
  kind: "background" | "audio";
  pid: number;
  language?: string;
}
/** One encoded asset's progress, named by package path and by its source stream. */
export type MediaAssetProgress = MediaProcessProgress & { assetPath: string; durationSeconds: number; source: MediaAssetSource };
export type MediaProcessRunner = (executable: string, args: string[], timeoutMs: number, signal?: AbortSignal, onProgress?: (progress: MediaProcessProgress) => void) => Promise<MediaProcessResult>;
export interface MediaToolInvocation { executable: string; args: string[]; }
export class MediaToolError extends Error {
  constructor(readonly diagnostic: { code: "MEDIA_TOOL_UNAVAILABLE" | "MEDIA_TOOL_COMMAND_FAILED" | "MEDIA_ENCODER_UNAVAILABLE"; executable: string; args: string[]; message: string }) {
    super(diagnostic.message);
    this.name = "MediaToolError";
  }
}
export type MediaJobErrorCode = "MEDIA_JOB_CANCELLED" | "MEDIA_JOB_TIMEOUT" | "MEDIA_PROCESS_FAILED" | "MEDIA_OUTPUT_INVALID";
export class MediaJobError extends Error {
  constructor(readonly diagnostic: { code: MediaJobErrorCode; executable?: string; args?: string[]; message: string }) {
    super(diagnostic.message);
    this.name = "MediaJobError";
  }
}
export interface MenuLoopMediaOptions {
  outputDirectory: string;
  /** Reuse encoded assets only when the previous package media plan matches this input. */
  reuseFromDirectory?: string;
  /** Package-relative directory for this playlist's encoded video and audio. */
  assetDirectory?: string;
  /** Package-relative path for this playlist's media plan. */
  planPath?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  timeoutMs?: number;
  crf?: number;
  preset?: "medium" | "fast" | "veryfast" | "ultrafast";
  /** Output video encoder. Defaults to `hevc`. */
  codec?: VideoCodec;
  /** Dynamic-range policy for HDR sources. Defaults to `tonemap` (SDR BT.709). */
  hdrMode?: HdrMode;
  /** Maximum bytes for one encoded media asset. Null disables the per-asset cap. */
  maxAssetBytes?: number | null;
  estimatedVideoBitsPerSecond?: number;
  estimatedAudioBitsPerSecond?: number;
  containerOverheadPercent?: number;
  signal?: AbortSignal;
  runProcess?: MediaProcessRunner;
  onProgress?: (progress: MediaAssetProgress) => void;
}
export interface MediaPlan {
  status: "partial";
  playlistId: string;
  playItemIndex: number;
  clipId: string;
  sourceFile: string;
  sourceIn45k: number;
  sourceOut45k: number;
  loopStart45k?: number;
  includeIntro?: boolean;
  durationSeconds: number;
  repeatCount: number;
  backgroundMode: "single-clip" | "loop-one-clip" | "still-last-frame";
  videoPid: number;
  audioTracks: MediaAudioTrackInput[];
  encoding: {
    video: {
      codec: VideoCodec; pixelFormat: string; preset: string; crf: number;
      aspectRatioPolicy: "preserve-source-display-aspect"; frameRatePolicy: "passthrough"; evenDimensions: true;
      color: { policy: HdrMode; source: SourceColor; output: OutputColor; filterChain: ColorFilterChain };
    };
    audio: { codec: "aac"; bitrate: "192k" };
    container: { video: "mp4"; audio: "m4a"; faststart: true };
  };
  budget: MenuLoopBudgetEstimate & { existingOutputBytes: string; maxAssetBytes: number | null };
  limitations: string[];
}
export interface ExportedMediaAsset { path: string; absolutePath: string; byteLength: number; codec: VideoCodec | "aac"; pid: number; streamNumber?: number; language?: string; }
export interface MenuLoopMediaResult {
  plan: MediaPlan;
  outputSize: { beforeBytes: string; afterBytes: string };
  tools: { ffmpeg: string; ffprobe: string; invocations: MediaToolInvocation[] };
  background: ExportedMediaAsset & { width: number; height: number; durationSeconds: number; loop: boolean; loopStartSeconds?: number };
  audioTracks: Array<ExportedMediaAsset & { language: string; durationSeconds: number; loopStartSeconds?: number }>;
  files: Array<{ path: string; absolutePath: string; byteLength: number }>;
  /** Colour-pipeline warnings that did not block the export. */
  warnings: ColorWarning[];
}

export interface MenuLoopEncoding {
  codec: VideoCodec;
  crf: number;
  preset: string;
  color: Pick<VideoColorPlan, "policy" | "source" | "output" | "filterChain">;
}

/** Encoding choices known before the source is probed; the colour plan comes from the reused media plan. */
interface ReuseEncoding { codec: VideoCodec; crf: number; preset: string; hdrMode: HdrMode; }

interface ProbeStream extends ColorProbeFields { index?: number; id?: string; codec_type?: string; codec_name?: string; width?: number; height?: number; display_aspect_ratio?: string; duration?: string; }
interface ProbeResult { streams?: ProbeStream[]; format?: { start_time?: string; duration?: string }; }

/** Export one validated menu-loop clip as a local video asset and per-track AAC files. */
export async function exportMenuLoopMedia(input: MenuLoopMediaInput, options: MenuLoopMediaOptions): Promise<MenuLoopMediaResult> {
  validateInput(input);
  if (!options.outputDirectory) throw new TypeError("outputDirectory is required");
  const timeoutMs = options.timeoutMs ?? 20 * 60 * 1000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RangeError("timeoutMs must be a positive safe integer");
  const codec = options.codec ?? "hevc";
  if (codec !== "h264" && codec !== "hevc") throw new RangeError(`codec must be 'h264' or 'hevc', received '${String(codec)}'`);
  const hdrMode = options.hdrMode ?? "tonemap";
  if (hdrMode !== "tonemap" && hdrMode !== "preserve") throw new RangeError(`hdrMode must be 'tonemap' or 'preserve', received '${String(hdrMode)}'`);
  const crf = options.crf ?? (codec === "hevc" ? 24 : 18);
  if (!Number.isInteger(crf) || crf < 0 || crf > 51) throw new RangeError("crf must be from 0 through 51");
  const preset = options.preset ?? "veryfast";
  const ffmpeg = options.ffmpegPath ?? "ffmpeg";
  const ffprobe = options.ffprobePath ?? "ffprobe";
  const run = options.runProcess ?? runProcess;
  const invocations: MediaToolInvocation[] = [];
  const invoke: MediaProcessRunner = async (executable, args, limit, signal, onProgress) => {
    invocations.push({ executable, args: [...args] });
    if (signal?.aborted || options.signal?.aborted) throw new MediaJobError({ code: "MEDIA_JOB_CANCELLED", executable, args: [...args], message: `Media job '${executable}' was cancelled before launch.` });
    const controller = new AbortController();
    let cancelled = false;
    let rejectCancelled: ((error: Error) => void) | undefined;
    const abortPromise = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
    const abort = () => {
      cancelled = true;
      controller.abort();
      rejectCancelled?.(new MediaJobError({ code: "MEDIA_JOB_CANCELLED", executable, args: [...args], message: `Media job '${executable}' was cancelled.` }));
    };
    signal?.addEventListener("abort", abort, { once: true });
    options.signal?.addEventListener("abort", abort, { once: true });
    let rejectTimeout: ((error: Error) => void) | undefined;
    const timeout = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
    const processPromise = run(executable, args, limit, controller.signal, onProgress);
    const timer = setTimeout(() => {
      controller.abort();
      rejectTimeout?.(new MediaJobError({ code: "MEDIA_JOB_TIMEOUT", executable, args: [...args], message: `Media job '${executable}' timed out after ${limit} ms.` }));
    }, limit);
    try { return await Promise.race([processPromise, timeout, abortPromise]); }
    catch (error) {
      controller.abort();
      await processPromise.catch(() => undefined);
      if (error instanceof MediaJobError || error instanceof MediaToolError) throw error;
      const processCode = (error as NodeJS.ErrnoException).code;
      const unavailable = processCode === "ENOENT" || (error instanceof Error && /\bENOENT\b/.test(error.message));
      if (cancelled) throw new MediaJobError({ code: "MEDIA_JOB_CANCELLED", executable, args: [...args], message: `Media job '${executable}' was cancelled.` });
      if (!unavailable) throw new MediaJobError({ code: "MEDIA_PROCESS_FAILED", executable, args: [...args], message: `Media tool '${executable}' failed while running ${args[0] ?? "its requested operation"}: ${error instanceof Error ? error.message : String(error)}` });
      throw new MediaToolError({ code: "MEDIA_TOOL_UNAVAILABLE", executable, args: [...args], message: `Required media tool '${executable}' is unavailable (ENOENT).` });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      options.signal?.removeEventListener("abort", abort);
    }
  };
  const output = resolve(options.outputDirectory);
  const assetDirectory = normalizePackageDirectory(options.assetDirectory ?? "assets/media");
  const planPath = normalizePackagePath(options.planPath ?? "media-plan.json");
  const mediaDirectory = resolve(output, assetDirectory);
  const planAbsolute = resolve(output, planPath);
  await ensureAbsent(planAbsolute);
  await mkdir(dirname(planAbsolute), { recursive: true });
  if (options.reuseFromDirectory) {
    const reused = await reuseMenuLoopMedia(input, options, resolve(options.reuseFromDirectory), output, mediaDirectory, planPath, { codec, crf, preset, hdrMode });
    if (reused) return reused;
  }

  validateOptionalByteLimit("maxAssetBytes", options.maxAssetBytes);
  const rates: MenuLoopBudgetRates = {
    estimatedVideoBitsPerSecond: options.estimatedVideoBitsPerSecond ?? 8_000_000,
    estimatedAudioBitsPerSecond: options.estimatedAudioBitsPerSecond ?? 192_000,
    containerOverheadPercent: options.containerOverheadPercent ?? 5,
  };
  validateBudgetRates(rates);
  const exportStart45k = input.includeIntro ? input.inTime45k : input.loopStart45k ?? input.inTime45k;
  const exportDuration45k = input.outTime45k - exportStart45k;
  const exportDuration = exportDuration45k / 45_000;
  const loopStartSeconds = loopBackground(input) ? ((input.loopStart45k ?? input.inTime45k) - exportStart45k) / 45_000 : undefined;
  const estimate = estimateMenuLoopBudget(exportDuration45k, input.audioTracks.length, rates);
  const backgroundPath = `${assetDirectory}/background.mp4`;
  const audioPaths = input.audioTracks.map((track) => `${assetDirectory}/audio-${track.pid.toString(16).padStart(4, "0")}-${safeLanguage(track.language)}.m4a`);
  for (const [path, bytes] of [[backgroundPath, estimate.videoBytes] as const, ...audioPaths.map((path, index) => [path, estimate.audioBytes[index]!] as const)]) {
    assertEstimateWithinLimit({ scope: "asset", estimateBytes: BigInt(bytes), limitBytes: options.maxAssetBytes, message: `Estimated media asset '${path}' exceeds maxAssetBytes before encoding.` });
    await ensureAbsent(resolve(output, path));
  }

  const existingOutputBytes = await directoryBytesExcluding(output, resolve(input.sourcePath));

  const ffmpegVersion = firstLine((await invoke(ffmpeg, ["-version"], timeoutMs)).stdout);
  const ffprobeVersion = firstLine((await invoke(ffprobe, ["-version"], timeoutMs)).stdout);
  const encoderArgs = ["-hide_banner", "-encoders"];
  const encoderList = await invoke(ffmpeg, encoderArgs, timeoutMs);
  const availableEncoders = `${encoderList.stdout}\n${encoderList.stderr}`;
  const missingEncoders = [videoEncoderName(codec), "aac"].filter((name) => !hasEncoder(availableEncoders, name));
  if (missingEncoders.length) throw new MediaToolError({
    code: "MEDIA_ENCODER_UNAVAILABLE", executable: ffmpeg, args: encoderArgs,
    message: `FFmpeg does not advertise required encoder${missingEncoders.length > 1 ? "s" : ""} ${missingEncoders.join(", ")}.`,
  });
  // Tone mapping needs zscale (libzimg); the export keeps HDR signalling and
  // reports a warning when the filter is not compiled in.
  const filterArgs = ["-hide_banner", "-filters"];
  const filterList = await invoke(ffmpeg, filterArgs, timeoutMs);
  const availableFilters = `${filterList.stdout}\n${filterList.stderr}`;
  const sourceProbe = parseProbe((await invoke(ffprobe, probeArgs(input.sourcePath, true), timeoutMs)).stdout, input.sourcePath);
  const sourceStart = Number(sourceProbe.format?.start_time);
  if (!Number.isFinite(sourceStart)) throw new Error(`ffprobe did not report the source timeline start for '${input.sourcePath}'.`);
  const rawSeekSeconds = exportStart45k / 45_000 - sourceStart;
  const seekSeconds = rawSeekSeconds < 0.000001 ? 0 : rawSeekSeconds;
  const videoStream = findPidStream(sourceProbe, input.videoPid, "video", input.sourcePath);
  if (!new Set(["h264", "hevc"]).has(videoStream.codec_name ?? "")) throw new Error(`Top Menu Clip ${input.clipId} video PID ${input.videoPid} uses unsupported codec ${videoStream.codec_name ?? "unknown"}; H.264 and HEVC inputs are supported.`);
  const audioStreams = input.audioTracks.map((track) => ({ track, stream: findPidStream(sourceProbe, track.pid, "audio", input.sourcePath) }));
  const aspectRatio = displayAspectRatio(videoStream);
  const colorPlan = planVideoColor(readSourceColor(videoStream), {
    policy: hdrMode, codec,
    hasZscale: hasFilter(availableFilters, "zscale"),
  });
  const encoding: MenuLoopEncoding = { codec, crf, preset, color: colorPlan };
  await mkdir(mediaDirectory, { recursive: true });

  const backgroundAbsolute = resolve(output, backgroundPath);
  const created: string[] = [];
  try {
    created.push(backgroundAbsolute);
    await runWithBudget(ffmpeg, [
      "-hide_banner", "-nostdin", "-loglevel", "error", "-progress", "pipe:2", "-stats_period", "1", "-n", "-i", input.sourcePath,
      "-ss", String(seekSeconds), "-map", pidSpecifier(input.videoPid), "-an", "-sn", "-dn", "-t", String(exportDuration),
      "-vf", colorPlan.videoFilter, ...videoEncoderArgs(colorPlan, codec, crf, preset), "-aspect", aspectRatio, "-fps_mode", "passthrough",
      "-movflags", "+faststart", "-metadata:s:v:0", "language=und", "-f", "mp4", backgroundAbsolute,
    ], timeoutMs, backgroundAbsolute, options.maxAssetBytes, invoke, options.signal,
    (progress) => options.onProgress?.({ ...progress, assetPath: backgroundPath, durationSeconds: exportDuration, source: { playlistId: input.playlistId, playItemIndex: input.playItemIndex, clipId: input.clipId, kind: "background", pid: input.videoPid } }));
    const backgroundProbe = await probeEncodedOutput(ffprobe, backgroundAbsolute, timeoutMs, invoke);
    let outputVideo: ProbeStream;
    let videoDuration: number;
    try {
      outputVideo = requireOneStream(backgroundProbe, "video", backgroundAbsolute);
      if (!positive(outputVideo.width) || !positive(outputVideo.height) || outputVideo.width % 2 !== 0 || outputVideo.height % 2 !== 0) throw new Error(`Encoded background video '${backgroundPath}' failed even-dimension verification.`);
      assertEncodedColor(outputVideo, colorPlan, codec, backgroundPath);
      if (!sameAspectRatio(displayAspectRatio(outputVideo), aspectRatio)) throw new Error(`Encoded background video '${backgroundPath}' display aspect ratio differs from source ratio ${aspectRatio}.`);
      videoDuration = streamDuration(outputVideo, backgroundProbe);
      assertDuration(videoDuration, exportDuration, backgroundPath);
    } catch (error) { throw outputInvalid(backgroundAbsolute, ffprobe, error); }
    const expectedDuration = exportDuration;
    const backgroundStat = await stat(backgroundAbsolute);

    const audioTracks: Array<ExportedMediaAsset & { language: string; durationSeconds: number }> = [];
    const files = [{ path: backgroundPath, absolutePath: backgroundAbsolute, byteLength: backgroundStat.size }];
    for (const { track } of audioStreams) {
      const stem = `audio-${track.pid.toString(16).padStart(4, "0")}-${safeLanguage(track.language)}`;
      const relativePath = `${assetDirectory}/${stem}.m4a`;
      const absolutePath = resolve(output, relativePath);
      created.push(absolutePath);
      await runWithBudget(ffmpeg, [
        "-hide_banner", "-nostdin", "-loglevel", "error", "-progress", "pipe:2", "-stats_period", "1", "-n", "-i", input.sourcePath,
        "-ss", String(seekSeconds), "-map", pidSpecifier(track.pid), "-vn", "-sn", "-dn", "-t", String(expectedDuration),
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
        "-metadata:s:a:0", `language=${safeLanguage(track.language)}`, "-f", "ipod", absolutePath,
      ], timeoutMs, absolutePath, options.maxAssetBytes, invoke, options.signal,
      (progress) => options.onProgress?.({ ...progress, assetPath: relativePath, durationSeconds: expectedDuration, source: { playlistId: input.playlistId, playItemIndex: input.playItemIndex, clipId: input.clipId, kind: "audio", pid: track.pid, language: track.language } }));
      const audioProbe = await probeEncodedOutput(ffprobe, absolutePath, timeoutMs, invoke);
      let audioDuration: number;
      try {
        const outputAudio = requireOneStream(audioProbe, "audio", absolutePath);
        if (outputAudio.codec_name !== "aac") throw new Error(`Encoded audio '${relativePath}' failed AAC verification.`);
        audioDuration = streamDuration(outputAudio, audioProbe);
        assertDuration(audioDuration, expectedDuration, relativePath);
      } catch (error) { throw outputInvalid(absolutePath, ffprobe, error); }
      const audioStat = await stat(absolutePath);
      const asset = { path: relativePath, absolutePath, byteLength: audioStat.size };
      files.push(asset);
      audioTracks.push({ ...asset, codec: "aac", pid: track.pid, streamNumber: track.streamNumber, language: track.language, durationSeconds: audioDuration, ...(loopStartSeconds === undefined ? {} : { loopStartSeconds }) });
    }

    const plan = makePlan(input, estimate, existingOutputBytes, options.maxAssetBytes ?? null, encoding);
    created.push(planAbsolute);
    await writeFile(planAbsolute, `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx" });
    const actualOutputBytes = await directoryBytesExcluding(output, resolve(input.sourcePath));
    const outputSize = { beforeBytes: existingOutputBytes.toString(), afterBytes: actualOutputBytes.toString() };
    return {
      plan, outputSize, tools: { ffmpeg: ffmpegVersion, ffprobe: ffprobeVersion, invocations },
      background: { path: backgroundPath, absolutePath: backgroundAbsolute, byteLength: backgroundStat.size, codec, pid: input.videoPid, width: outputVideo.width, height: outputVideo.height, durationSeconds: videoDuration, loop: loopBackground(input), ...(loopStartSeconds === undefined ? {} : { loopStartSeconds }) },
      audioTracks, files, warnings: colorPlan.warnings,
    };
  } catch (error) {
    await Promise.all(created.map((path) => unlink(path).catch(() => undefined)));
    throw error;
  }
}

async function reuseMenuLoopMedia(input: MenuLoopMediaInput, options: MenuLoopMediaOptions, sourceDirectory: string, output: string, mediaDirectory: string, planPath: string, encoding: ReuseEncoding): Promise<MenuLoopMediaResult | null> {
  const assetDirectory = normalizePackageDirectory(options.assetDirectory ?? "assets/media");
  let priorPlan: MediaPlan;
  let priorManifest: Record<string, unknown>;
  try {
    priorPlan = JSON.parse(await readFile(resolve(sourceDirectory, planPath), "utf8")) as MediaPlan;
    priorManifest = JSON.parse(await readFile(resolve(sourceDirectory, "asset-manifest.json"), "utf8")) as Record<string, unknown>;
  } catch { return null; }
  if (!matchesReusablePlan(priorPlan, input, encoding)) return null;
  const reusableEncoding: MenuLoopEncoding = { codec: encoding.codec, crf: encoding.crf, preset: encoding.preset, color: priorPlan.encoding.video.color };
  type PriorPackagedMedia = { plan?: { playlistId?: string; playItemIndex?: number }; background?: Record<string, unknown>; audioTracks?: Array<Record<string, unknown>> };
  const priorMenuMedia = Array.isArray(priorManifest.menuMedia) ? priorManifest.menuMedia as PriorPackagedMedia[] : [];
  // One menu playlist can carry several packaged PlayItems; the plan must match
  // the PlayItem as well as the playlist or a sub-menu reuses the Top Menu media.
  const media = [priorManifest.media as PriorPackagedMedia | undefined, ...priorMenuMedia]
    .find((candidate) => candidate?.plan?.playlistId === input.playlistId && (candidate.plan.playItemIndex ?? 0) === input.playItemIndex);
  const priorBackground = media?.background;
  const priorAudioTracks = media?.audioTracks;
  const backgroundPath = `${assetDirectory}/background.mp4`;
  if (!priorBackground || priorBackground.path !== backgroundPath || priorBackground.codec !== encoding.codec || priorBackground.pid !== input.videoPid
    || !positive(priorBackground.width) || !positive(priorBackground.height)
    || typeof priorBackground.durationSeconds !== "number" || !Number.isFinite(priorBackground.durationSeconds)
    || priorBackground.loop !== loopBackground(input) || !Array.isArray(priorAudioTracks) || priorAudioTracks.length !== input.audioTracks.length) return null;
  const audioRecords = input.audioTracks.map((track) => {
    const path = `${assetDirectory}/audio-${track.pid.toString(16).padStart(4, "0")}-${safeLanguage(track.language)}.m4a`;
    const previous = priorAudioTracks.find((candidate) => candidate.pid === track.pid && candidate.streamNumber === track.streamNumber && candidate.language === track.language && candidate.path === path && candidate.codec === "aac");
    if (!previous || typeof previous.durationSeconds !== "number" || !Number.isFinite(previous.durationSeconds)) return null;
    return { track, path, previous };
  });
  if (audioRecords.some((record) => record === null)) return null;
  const sourceFiles = [backgroundPath, ...audioRecords.map((record) => record!.path)];
  const sourceSizes = new Map<string, number>();
  try {
    for (const path of sourceFiles) {
      const info = await stat(resolve(sourceDirectory, path));
      if (!info.isFile()) return null;
      sourceSizes.set(path, info.size);
    }
  } catch { return null; }

  validateOptionalByteLimit("maxAssetBytes", options.maxAssetBytes);
  const rates: MenuLoopBudgetRates = {
    estimatedVideoBitsPerSecond: options.estimatedVideoBitsPerSecond ?? 8_000_000,
    estimatedAudioBitsPerSecond: options.estimatedAudioBitsPerSecond ?? 192_000,
    containerOverheadPercent: options.containerOverheadPercent ?? 5,
  };
  validateBudgetRates(rates);
  const estimate = estimateMenuLoopBudget(durationSeconds(input) * 45_000, input.audioTracks.length, rates);
  for (const path of sourceFiles) assertActualWithinLimit({ scope: "asset", actualBytes: BigInt(sourceSizes.get(path)!), limitBytes: options.maxAssetBytes, message: `Reused media asset '${path}' exceeds maxAssetBytes.` });
  const existingOutputBytes = await directoryBytesExcluding(output, resolve(input.sourcePath));
  await mkdir(mediaDirectory, { recursive: true });
  const copied: string[] = [];
  try {
    for (const path of sourceFiles) {
      const destination = resolve(output, path);
      await ensureAbsent(destination);
      await copyFile(resolve(sourceDirectory, path), destination);
      copied.push(destination);
    }
    const plan = makePlan(input, estimate, existingOutputBytes, options.maxAssetBytes ?? null, reusableEncoding, true);
    const files = sourceFiles.map((path) => ({ path, absolutePath: resolve(output, path), byteLength: sourceSizes.get(path)! }));
    const backgroundFile = files[0]!;
    const audioTracks = audioRecords.map((record, index) => {
      const file = files[index + 1]!;
      return { ...file, codec: "aac" as const, pid: record!.track.pid, streamNumber: record!.track.streamNumber, language: record!.track.language, durationSeconds: record!.previous.durationSeconds as number, ...(typeof priorBackground.loopStartSeconds === "number" ? { loopStartSeconds: priorBackground.loopStartSeconds } : {}) };
    });
    const planAbsolute = resolve(output, planPath);
    await writeFile(planAbsolute, `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx" });
    copied.push(planAbsolute);
    const actualOutputBytes = await directoryBytesExcluding(output, resolve(input.sourcePath));
    const outputSize = { beforeBytes: existingOutputBytes.toString(), afterBytes: actualOutputBytes.toString() };
    return {
      plan, outputSize, tools: { ffmpeg: "reused", ffprobe: "reused", invocations: [] },
      background: { ...backgroundFile, codec: encoding.codec, pid: input.videoPid, width: priorBackground.width, height: priorBackground.height, durationSeconds: priorBackground.durationSeconds, loop: loopBackground(input), ...(typeof priorBackground.loopStartSeconds === "number" ? { loopStartSeconds: priorBackground.loopStartSeconds } : {}) },
      audioTracks, files,
      warnings: [
        ...(priorPlan.encoding.video.color.filterChain === "hdr-passthrough-fallback"
          ? [{ code: "MEDIA_HDR_TONEMAP_UNAVAILABLE" as const, message: "Reused menu media keeps BT.2020/PQ signalling; the originating package was exported without a tone mapping filter." }]
          : []),
      ],
    };
  } catch (error) {
    await Promise.all(copied.map((path) => unlink(path).catch(() => undefined)));
    throw error;
  }
}

function matchesReusablePlan(plan: MediaPlan, input: MenuLoopMediaInput, encoding: ReuseEncoding): boolean {
  const loop = loopBackground(input);
  const mode = input.stillMode === 2 ? "still-last-frame" : loop ? "loop-one-clip" : "single-clip";
  return plan.playlistId === input.playlistId && plan.playItemIndex === input.playItemIndex && plan.clipId === input.clipId
    && plan.sourceFile === input.sourceFile && plan.sourceIn45k === input.inTime45k && plan.sourceOut45k === input.outTime45k
    && plan.loopStart45k === input.loopStart45k && plan.includeIntro === input.includeIntro && plan.repeatCount === input.repeatCount && plan.backgroundMode === mode
    && plan.videoPid === input.videoPid && plan.encoding?.video?.codec === encoding.codec && plan.encoding.video.preset === encoding.preset && plan.encoding.video.crf === encoding.crf
    && plan.encoding.video.color?.policy === encoding.hdrMode
    && plan.audioTracks.length === input.audioTracks.length && plan.audioTracks.every((track, index) => {
      const current = input.audioTracks[index]!;
      return track.streamNumber === current.streamNumber && track.pid === current.pid && track.language === current.language;
    });
}

export function pidSpecifier(pid: number): string { validatePid(pid); return `0:i:0x${pid.toString(16)}`; }
function loopBackground(input: Pick<MenuLoopMediaInput, "stillMode" | "repeatCount" | "loopBackground">): boolean {
  return input.loopBackground ?? (input.stillMode !== 2 && input.repeatCount > 1);
}
export function durationSeconds(input: Pick<MenuLoopMediaInput, "inTime45k" | "outTime45k" | "loopStart45k" | "includeIntro">): number {
  return (input.outTime45k - (input.includeIntro ? input.inTime45k : input.loopStart45k ?? input.inTime45k)) / 45_000;
}

export function resolveMenuLoopStart45k(playItemIndex: number, inTime45k: number, outTime45k: number, marks: readonly { type: number; playItemRef: number; time45k: number }[]): number | undefined {
  return marks.filter((mark) => mark.type === 1 && mark.playItemRef === playItemIndex && mark.time45k > inTime45k && mark.time45k < outTime45k).at(-1)?.time45k;
}

function validateInput(input: MenuLoopMediaInput): void {
  for (const key of ["playlistId", "clipId", "sourceFile", "sourcePath"] as const) if (!input[key]) throw new TypeError(`${key} is required`);
  for (const [name, value] of Object.entries({ playItemIndex: input.playItemIndex, inTime45k: input.inTime45k, outTime45k: input.outTime45k, stillMode: input.stillMode, repeatCount: input.repeatCount })) if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`);
  if (input.outTime45k <= input.inTime45k) throw new RangeError("outTime45k must be greater than inTime45k");
  if (input.loopStart45k !== undefined && (!Number.isSafeInteger(input.loopStart45k) || input.loopStart45k <= input.inTime45k || input.loopStart45k >= input.outTime45k)) throw new RangeError("loopStart45k must be an integer inside the PlayItem interval and after inTime45k");
  if (input.stillMode > 2) throw new RangeError("stillMode must be one of the defined Playlist PlayItem modes (0, 1, or 2)");
  if (input.repeatCount < 1) throw new RangeError("repeatCount must be positive");
  validatePid(input.videoPid);
  const seen = new Set<number>();
  for (const [index, track] of input.audioTracks.entries()) {
    validatePid(track.pid);
    if (!Number.isSafeInteger(track.streamNumber) || track.streamNumber !== index) throw new RangeError(`Audio streamNumber must match zero-based primary-audio declaration order (${index})`);
    if (!/^[A-Za-z]{3}$/.test(track.language)) throw new TypeError(`Audio PID ${track.pid} requires a three-letter language code`);
    if (seen.has(track.pid)) throw new TypeError(`Duplicate audio PID ${track.pid}`);
    seen.add(track.pid);
  }
}

function validatePid(pid: number): void { if (!Number.isInteger(pid) || pid < 0 || pid > 0x1fff) throw new RangeError(`MPEG-TS PID ${pid} is out of range`); }
function safeLanguage(value: string): string { return value.toLocaleLowerCase("en-US"); }
function hasEncoder(output: string, encoder: string): boolean {
  return output.split(/\r?\n/).some((line) => /^\s*[VAS.D]{6}\s+/.test(line) && line.trim().split(/\s+/, 2)[1] === encoder);
}
function hasFilter(output: string, filter: string): boolean {
  return output.split(/\r?\n/).some((line) => /^\s*[TSC.]{2,3}\s+/.test(line) && line.trim().split(/\s+/, 2)[1] === filter);
}
function firstLine(value: string): string { return value.split(/\r?\n/, 1)[0] ?? "unknown"; }
function probeArgs(path: string, deep = false): string[] {
  // A Blu-ray still menu can open with frames that carry no parameter sets, so
  // the default probe window reports the video stream without dimensions. The
  // source probe reads deeper; encoded outputs keep the cheap default.
  const depth = deep ? ["-probesize", "100M", "-analyzeduration", "100M"] : [];
  return ["-v", "error", ...depth, "-show_entries", "stream=index,id,codec_type,codec_name,width,height,display_aspect_ratio,duration,pix_fmt,color_range,color_space,color_transfer,color_primaries,bits_per_raw_sample:stream_side_data=side_data_type:format=start_time,duration", "-of", "json", path];
}
function parseProbe(text: string, subject: string): ProbeResult {
  try {
    const value = JSON.parse(text) as ProbeResult;
    if (!Array.isArray(value.streams)) throw new Error("no streams array");
    return value;
  } catch (error) { throw new Error(`ffprobe returned invalid stream metadata for '${subject}': ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
}
async function probeEncodedOutput(ffprobe: string, path: string, timeoutMs: number, run: MediaProcessRunner): Promise<ProbeResult> {
  const args = probeArgs(path);
  const response = await run(ffprobe, args, timeoutMs);
  try { return parseProbe(response.stdout, path); }
  catch (error) { throw outputInvalid(path, ffprobe, error); }
}
function outputInvalid(path: string, ffprobe: string, error: unknown): MediaJobError {
  const message = `Encoded output '${path}' failed FFprobe validation: ${error instanceof Error ? error.message : String(error)}`;
  return new MediaJobError({ code: "MEDIA_OUTPUT_INVALID", executable: ffprobe, args: probeArgs(path), message });
}
function findPidStream(probe: ProbeResult, pid: number, type: string, subject: string): ProbeStream {
  const match = probe.streams?.find((stream) => stream.codec_type === type && parseStreamId(stream.id) === pid);
  if (!match) throw new Error(`Clip media '${subject}' has no ${type} stream for declared PID ${pid}.`);
  return match;
}
function parseStreamId(id: string | undefined): number | null { if (!id) return null; if (/^0x[0-9a-f]+$/i.test(id)) return Number.parseInt(id.slice(2), 16); if (/^[0-9]+$/.test(id)) return Number(id); return null; }
function displayAspectRatio(stream: ProbeStream): string {
  if (stream.display_aspect_ratio && /^\d+:\d+$/.test(stream.display_aspect_ratio)) return stream.display_aspect_ratio;
  if (!positive(stream.width) || !positive(stream.height)) throw new Error("ffprobe did not report valid video dimensions for aspect-ratio preservation.");
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const divisor = gcd(stream.width, stream.height);
  return `${stream.width / divisor}:${stream.height / divisor}`;
}
function sameAspectRatio(left: string, right: string): boolean {
  const [leftWidth, leftHeight] = left.split(":").map(Number);
  const [rightWidth, rightHeight] = right.split(":").map(Number);
  return Number.isSafeInteger(leftWidth) && Number.isSafeInteger(leftHeight) && Number.isSafeInteger(rightWidth) && Number.isSafeInteger(rightHeight)
    && leftWidth! * rightHeight! === rightWidth! * leftHeight!;
}
function requireOneStream(probe: ProbeResult, type: string, subject: string): ProbeStream {
  const streams = probe.streams?.filter((stream) => stream.codec_type === type) ?? [];
  if (streams.length !== 1) throw new Error(`Encoded media '${subject}' must contain one ${type} stream; found ${streams.length}.`);
  return streams[0]!;
}
function streamDuration(stream: ProbeStream, probe: ProbeResult): number {
  const duration = Number(stream.duration ?? probe.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("ffprobe did not report a positive media duration.");
  return duration;
}
function assertDuration(actual: number, expected: number, path: string): void { if (Math.abs(actual - expected) > 0.25) throw new Error(`Encoded media '${path}' duration ${actual.toFixed(3)}s differs from planned ${expected.toFixed(3)}s by more than 0.25s.`); }
function positive(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
async function ensureAbsent(path: string): Promise<void> {
  try { await access(path); throw new Error(`Media export target already exists: '${path}'.`); }
  catch (error) { if (error instanceof Error && error.message.startsWith("Media export target already exists:")) throw error; if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

async function runProcess(executable: string, args: string[], timeoutMs: number, signal?: AbortSignal, onProgress?: (progress: MediaProcessProgress) => void): Promise<MediaProcessResult> {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = []; const stderr: Buffer[] = []; let size = 0; let finished = false; let requestedError: Error | undefined; let killTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, result?: MediaProcessResult) => {
      if (finished) return; finished = true; clearTimeout(timer); if (killTimer) clearTimeout(killTimer); signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolveResult(result!);
    };
    const terminate = (error: Error) => {
      requestedError ??= error;
      child.kill("SIGTERM");
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), 1000);
    };
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > 4 * 1024 * 1024) { terminate(new MediaJobError({ code: "MEDIA_PROCESS_FAILED", executable, args: [...args], message: `${executable} output exceeded 4 MiB.` })); return; }
      target.push(chunk);
    };
    let progressOutput = "";
    let progressFields: Record<string, string> = {};
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", (chunk: Buffer) => {
      collect(stderr)(chunk);
      if (!onProgress) return;
      progressOutput += chunk.toString("utf8");
      const lines = progressOutput.split(/\r?\n/);
      progressOutput = lines.pop() ?? "";
      for (const line of lines) {
        const separator = line.indexOf("=");
        if (separator < 1) continue;
        const key = line.slice(0, separator);
        const value = line.slice(separator + 1);
        progressFields[key] = value;
        if (key === "progress" && (value === "continue" || value === "end")) {
          const micros = Number(progressFields.out_time_us);
          if (Number.isFinite(micros) && micros >= 0) onProgress({ outTimeSeconds: micros / 1_000_000, state: value });
          progressFields = {};
        }
      }
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code, closeSignal) => {
      if (requestedError) return finish(requestedError);
      if (code !== 0) return finish(new Error(`${executable} exited ${code ?? closeSignal}: ${Buffer.concat(stderr).toString("utf8").trim()}`));
      finish(undefined, { stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
    const timer = setTimeout(() => terminate(new MediaJobError({ code: "MEDIA_JOB_TIMEOUT", executable, args: [...args], message: `${executable} timed out after ${timeoutMs} ms.` })), timeoutMs);
    const abort = () => terminate(new MediaJobError({ code: "MEDIA_JOB_CANCELLED", executable, args: [...args], message: `${executable} was cancelled.` }));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export const runMediaProcess: MediaProcessRunner = runProcess;

function normalizePackageDirectory(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => part === "" || part === "." || part === "..")) throw new RangeError(`assetDirectory must be a package-relative directory, received '${value}'.`);
  return normalized;
}

function normalizePackagePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => part === "" || part === "." || part === "..")) throw new RangeError(`planPath must be a package-relative file path, received '${value}'.`);
  return normalized;
}

function makePlan(input: MenuLoopMediaInput, estimate: MenuLoopBudgetEstimate, existingOutputBytes: bigint, maxAssetBytes: number | null, encoding: MenuLoopEncoding, reused = false): MediaPlan {
  const fallback = encoding.color.filterChain === "hdr-passthrough-fallback";
  const hdrWithoutHevc = encoding.codec === "h264" && encoding.color.output.bitDepth === 10;
  return {
    status: "partial", playlistId: input.playlistId, playItemIndex: input.playItemIndex, clipId: input.clipId,
    sourceFile: input.sourceFile, sourceIn45k: input.inTime45k, sourceOut45k: input.outTime45k,
    ...(input.loopStart45k !== undefined ? { loopStart45k: input.loopStart45k } : {}), ...(input.includeIntro ? { includeIntro: true } : {}),
    durationSeconds: durationSeconds(input), repeatCount: input.repeatCount,
    backgroundMode: input.stillMode === 2 ? "still-last-frame" : loopBackground(input) ? "loop-one-clip" : "single-clip", videoPid: input.videoPid,
    audioTracks: input.audioTracks.map((track) => ({ ...track })),
    encoding: {
      video: {
        codec: encoding.codec, pixelFormat: `yuv420p${encoding.color.output.bitDepth === 10 ? "10le" : ""}`, preset: encoding.preset, crf: encoding.crf,
        aspectRatioPolicy: "preserve-source-display-aspect", frameRatePolicy: "passthrough", evenDimensions: true,
        color: { policy: encoding.color.policy, source: encoding.color.source, output: encoding.color.output, filterChain: encoding.color.filterChain },
      },
      audio: { codec: "aac", bitrate: "192k" },
      container: { video: "mp4", audio: "m4a", faststart: true },
    },
    budget: { ...estimate, existingOutputBytes: existingOutputBytes.toString(), maxAssetBytes },
    limitations: [
      input.stillMode === 2 ? "This output covers the single infinite-still PlayItem and its declared audio tracks." : loopBackground(input) ? "This output covers the repeated menu background clip and its declared audio tracks." : "This output covers one non-repeating PlayItem and its declared audio tracks.",
      "Multi-PlayItem linear precomposition and branch-specific feature media are unsupported by this menu background export contract.",
      ...(fallback ? ["No tone mapping filter is available; HDR source signalling is preserved and SDR displays render this asset with reduced contrast. Install an FFmpeg build with libzimg to convert HDR to SDR."] : []),
      ...(hdrWithoutHevc ? ["HDR signalling is written into an H.264 stream, which browsers decode as SDR; use --codec hevc to keep HDR playback."] : []),
      reused ? "Encoded assets are reused from a prior package when its media plan matches; source content changes at the same path are not fingerprinted." : "On overwrite, prior media assets are reused when playlist, clip, time bounds, stream declarations, and encoding settings match; source content changes at the same path are not fingerprinted.",
    ],
  };
}

async function runWithBudget(executable: string, args: string[], timeoutMs: number, assetPath: string, maxAssetBytes: number | null | undefined, run: MediaProcessRunner, externalSignal?: AbortSignal, onProgress?: (progress: MediaProcessProgress) => void): Promise<MediaProcessResult> {
  const controller = new AbortController();
  let stopMonitor: (() => void) | undefined;
  let externalAbortHandler: (() => void) | undefined;
  const processPromise = run(executable, args, timeoutMs, controller.signal, onProgress);
  const monitorPromise = new Promise<never>((_resolve, reject) => {
    let checkingAsset = false;
    const fail = (error: unknown) => {
      controller.abort();
      reject(error instanceof Error ? error : new Error("Media asset monitoring failed.", { cause: error }));
    };
    const checkAsset = async () => {
      if (checkingAsset) return;
      checkingAsset = true;
      try {
        const assetBytes = await pathBytes(assetPath);
        assertActualWithinLimit({ scope: "asset", actualBytes: assetBytes, limitBytes: maxAssetBytes, message: `Encoded media asset '${assetPath}' exceeded maxAssetBytes during encoding.` });
      } catch (error) { fail(error); }
      finally { checkingAsset = false; }
    };
    const assetTimer = setInterval(() => { void checkAsset(); }, 10);
    stopMonitor = () => { clearInterval(assetTimer); };
    void checkAsset();
  });
  const externalAbortPromise = new Promise<never>((_resolve, reject) => {
    externalAbortHandler = () => {
      controller.abort();
      reject(new MediaJobError({ code: "MEDIA_JOB_CANCELLED", executable, args: [...args], message: `Media job '${executable}' was cancelled.` }));
    };
    if (externalSignal?.aborted) externalAbortHandler();
    else externalSignal?.addEventListener("abort", externalAbortHandler, { once: true });
  });
  try {
    const result = await Promise.race([processPromise, monitorPromise, externalAbortPromise]);
    assertActualWithinLimit({ scope: "asset", actualBytes: await pathBytes(assetPath), limitBytes: maxAssetBytes, message: `Encoded media asset '${assetPath}' exceeded maxAssetBytes at process completion.` });
    return result;
  } catch (error) {
    controller.abort();
    await processPromise.catch(() => undefined);
    throw error;
  } finally {
    stopMonitor?.();
    if (externalAbortHandler) externalSignal?.removeEventListener("abort", externalAbortHandler);
  }
}

async function pathBytes(path: string): Promise<bigint> {
  try { return BigInt((await stat(path)).size); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0n; throw error; }
}
