import { errorText } from "@bdmv2web/utils";
import { access, copyFile, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { directoryBytesExcluding, fileBytes } from "@bdmv2web/utils/node-fs";
import { hasEncoder, hasFilter } from "./tools/ffmpeg-capabilities.js";
import { parseProbe, probeArgs, type ProbeResult, type ProbeStream } from "./tools/probe.js";
import { runControlledProcess, runMonitoredProcess } from "./process/process-control.js";
import { assertActualWithinLimit, assertEstimateWithinLimit, estimateMenuLoopBudget, validateBudgetRates, validateOptionalByteLimit, type MenuLoopBudgetEstimate, type MenuLoopBudgetRates } from "./budget.js";
import { assertEncodedColor, normalizeColorTag, pixelFormatBitDepth, planVideoColor, readSourceColor, videoEncoderArgs, videoEncoderName, type HdrMode, type VideoCodec, type VideoColorPlan } from "./color/color.js";

export * from "./closure.js";
export * from "./external-targets.js";
export * from "./media-plan.js";
export * from "./timeline.js";
export * from "./seek.js";
export * from "./linear.js";
export { MediaBudgetError, validateOptionalByteLimit, validateBudgetRates, estimateMenuLoopBudget, assertEstimateWithinLimit, assertActualWithinLimit } from "./budget.js";
export type { MenuLoopBudgetEstimate, MenuLoopBudgetRates, MediaBudgetDiagnostic } from "./budget.js";
export * from "./color/color.js";
export * from "./pgs/pgs.js";
export * from "./pgs/pgs-render.js";

export * from "./pgs/pgs-extract.js";
export type {
  MediaProcessResult, MediaProcessProgress, MediaProcessRunner, MediaToolInvocation,
  MediaAudioTrackInput, VideoExportMode, MenuLoopMediaInput, MediaAssetSource,
  MediaAssetProgress, MenuLoopMediaOptions, MediaPlan, ExportedMediaAsset,
  MediaWarning, MenuLoopMediaResult, MenuLoopEncoding,
} from "./media-types.js";
export * from "./process/process.js";
import type { MediaProcessProgress, MediaProcessResult, MediaProcessRunner, MediaToolInvocation, VideoExportMode, MenuLoopMediaInput, MenuLoopMediaOptions, MediaPlan, MenuLoopMediaResult, MenuLoopEncoding, MediaWarning, ExportedMediaAsset } from "./media-types.js";
import { MediaJobError, MediaToolError, runMediaProcess as runProcess } from "./process/process.js";

interface ReuseEncoding { codec: VideoCodec; crf: number; preset: string; hdrMode: HdrMode; videoMode: VideoExportMode; }

interface MediaToolFacts { ffmpegVersion: string; ffprobeVersion: string; encoders: string; filters: string; }

const toolFactCache = new WeakMap<MediaProcessRunner, Map<string, Promise<MediaToolFacts>>>();
function toolFacts(run: MediaProcessRunner, invoke: MediaProcessRunner, ffmpeg: string, ffprobe: string, timeoutMs: number): Promise<MediaToolFacts> {
  let perRunner = toolFactCache.get(run);
  if (perRunner === undefined) { perRunner = new Map(); toolFactCache.set(run, perRunner); }
  const key = `${ffmpeg}\u0000${ffprobe}`;
  const cached = perRunner.get(key);
  if (cached !== undefined) return cached;
  const pending = probeToolFacts(invoke, ffmpeg, ffprobe, timeoutMs);
  perRunner.set(key, pending);
  void pending.catch(() => { if (perRunner.get(key) === pending) perRunner.delete(key); });
  return pending;
}

async function probeToolFacts(invoke: MediaProcessRunner, ffmpeg: string, ffprobe: string, timeoutMs: number): Promise<MediaToolFacts> {
  const ffmpegVersion = firstLine((await invoke(ffmpeg, ["-version"], timeoutMs)).stdout);
  const ffprobeVersion = firstLine((await invoke(ffprobe, ["-version"], timeoutMs)).stdout);
  const encoderList = await invoke(ffmpeg, ["-hide_banner", "-encoders"], timeoutMs);
  const filterList = await invoke(ffmpeg, ["-hide_banner", "-filters"], timeoutMs);
  return { ffmpegVersion, ffprobeVersion, encoders: `${encoderList.stdout}\n${encoderList.stderr}`, filters: `${filterList.stdout}\n${filterList.stderr}` };
}

/** Export one validated menu-loop clip as a local video asset and per-track AAC files. */
export async function exportMenuLoopMedia(input: MenuLoopMediaInput, options: MenuLoopMediaOptions): Promise<MenuLoopMediaResult> {
  validateInput(input);
  if (!options.outputDirectory) throw new TypeError("outputDirectory is required");
  const timeoutMs = options.timeoutMs ?? 20 * 60 * 1000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RangeError("timeoutMs must be a positive safe integer");
  const codec = options.codec ?? (options.videoMode === "copy" ? "h264" : "hevc");
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
    return runControlledProcess({
      run: (processSignal) => run(executable, args, limit, processSignal, onProgress),
      signals: [signal, options.signal], timeoutMs: limit,
      cancellationError: () => new MediaJobError({ code: "MEDIA_JOB_CANCELLED", executable, args: [...args], message: `Media job '${executable}' was cancelled.` }),
      timeoutError: () => new MediaJobError({ code: "MEDIA_JOB_TIMEOUT", executable, args: [...args], message: `Media job '${executable}' timed out after ${limit} ms.` }),
      processError: (error, cancelled) => {
        if (error instanceof MediaJobError || error instanceof MediaToolError) return error;
        const processCode = (error as NodeJS.ErrnoException).code;
        const unavailable = processCode === "ENOENT" || (error instanceof Error && /\bENOENT\b/.test(error.message));
        if (cancelled) return new MediaJobError({ code: "MEDIA_JOB_CANCELLED", executable, args: [...args], message: `Media job '${executable}' was cancelled.` });
        if (!unavailable) return new MediaJobError({ code: "MEDIA_PROCESS_FAILED", executable, args: [...args], message: `Media tool '${executable}' failed while running ${args[0] ?? "its requested operation"}: ${errorText(error)}` });
        return new MediaToolError({ code: "MEDIA_TOOL_UNAVAILABLE", executable, args: [...args], message: `Required media tool '${executable}' is unavailable (ENOENT).` });
      },
    });
  };
  const output = resolve(options.outputDirectory);
  const assetDirectory = normalizePackageDirectory(options.assetDirectory ?? "assets/media");
  const planPath = normalizePackagePath(options.planPath ?? "media-plan.json");
  const mediaDirectory = resolve(output, assetDirectory);
  const planAbsolute = resolve(output, planPath);
  await ensureAbsent(planAbsolute);
  await mkdir(dirname(planAbsolute), { recursive: true });
  if (options.reuseFromDirectory) {
    const sourceDirectory = resolve(options.reuseFromDirectory);
    for (const prior of [undefined, ...(options.reuseAlternatives ?? [])]) {
      const videoMode: VideoExportMode = options.videoMode === "copy" ? "copy" : "encode";
      const reused = await reuseMenuLoopMedia(input, options, sourceDirectory, output, mediaDirectory, planPath, prior, { codec, crf, preset, hdrMode, videoMode }, { invoke, ffprobe, timeoutMs });
      if (reused) return reused;
    }
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
  for (const path of [backgroundPath, ...audioPaths]) await ensureAbsent(resolve(output, path));
  for (const [path, bytes] of audioPaths.map((path, index) => [path, estimate.audioBytes[index]!] as const)) {
    assertEstimateWithinLimit({ scope: "asset", estimateBytes: BigInt(bytes), limitBytes: options.maxAssetBytes, message: `Estimated media asset '${path}' exceeds maxAssetBytes before encoding.` });
  }

  const existingOutputBytes = await directoryBytesExcluding(output, resolve(input.sourcePath));

  const facts = await toolFacts(run, invoke, ffmpeg, ffprobe, timeoutMs);
  const ffmpegVersion = facts.ffmpegVersion;
  const ffprobeVersion = facts.ffprobeVersion;
  const encoderArgs = ["-hide_banner", "-encoders"];
  const missingEncoders = [videoEncoderName(codec), "aac"].filter((name) => !hasEncoder(facts.encoders, name));
  if (missingEncoders.length) throw new MediaToolError({
    code: "MEDIA_ENCODER_UNAVAILABLE", executable: ffmpeg, args: encoderArgs,
    message: `FFmpeg does not advertise required encoder${missingEncoders.length > 1 ? "s" : ""} ${missingEncoders.join(", ")}.`,
  });
  // Tone mapping needs zscale (libzimg); the export keeps HDR signalling and
  // reports a warning when the filter is not compiled in.
  const availableFilters = facts.filters;
  const sourceProbeArguments = probeArgs(input.sourcePath, { deep: true });
  const sourceProbeKey = JSON.stringify([ffprobe, timeoutMs, sourceProbeArguments]);
  const sourceProbeCache = options.sourceProbeCache;
  let sourceProbePromise = sourceProbeCache?.get(sourceProbeKey);
  if (sourceProbePromise === undefined) {
    sourceProbePromise = invoke(ffprobe, sourceProbeArguments, timeoutMs);
    if (sourceProbeCache !== undefined) {
      sourceProbeCache.set(sourceProbeKey, sourceProbePromise);
      void sourceProbePromise.catch(() => {
        if (sourceProbeCache.get(sourceProbeKey) === sourceProbePromise) sourceProbeCache.delete(sourceProbeKey);
      });
    }
  }
  const sourceProbe = parseProbe((await sourceProbePromise).stdout, input.sourcePath, "ffprobe returned invalid stream metadata for");
  const sourceStart = Number(sourceProbe.format?.start_time);
  if (!Number.isFinite(sourceStart)) throw new Error(`ffprobe did not report the source timeline start for '${input.sourcePath}'.`);
  const rawSeekSeconds = exportStart45k / 45_000 - sourceStart;
  const seekSeconds = rawSeekSeconds < 0.000001 ? 0 : rawSeekSeconds;
  const videoStream = findPidStream(sourceProbe, input.videoPid, "video", input.sourcePath);
  if (!new Set(["h264", "hevc"]).has(videoStream.codec_name ?? "")) throw new Error(`Top Menu Clip ${input.clipId} video PID ${input.videoPid} uses unsupported codec ${videoStream.codec_name ?? "unknown"}; H.264 and HEVC inputs are supported.`);
  const audioStreams = input.audioTracks.map((track) => findPidStream(sourceProbe, track.pid, "audio", input.sourcePath, track.codingType));
  const aspectRatio = displayAspectRatio(videoStream);
  const colorPlan = planVideoColor(readSourceColor(videoStream), {
    policy: hdrMode, codec,
    hasZscale: hasFilter(availableFilters, "zscale"),
  });
  // A stream copy keeps the source bitstream, so nothing may be filtered and the
  // copy has to begin where a player begins decoding. libbluray seeks to the entry
  // point at or before the PlayItem in-time (`clpi_lookup_spn(in_time, before=1)`
  // in navigation.c) and then wipes packets until the first PES with `pts >=
  // in_time` (m2ts_filter.c), so the first presented frame is the one holding the
  // start. Entry-point times are stored as `coarse << 18 | fine << 8`, i.e. the
  // frame time floored to a 256-tick grid, so a start within that grid names that
  // same frame; a later start would copy leading frames the player never shows.
  const copyRequested = options.videoMode === "copy";
  const copyHeadroom45k = input.copyStart45k === undefined ? undefined : exportStart45k - input.copyStart45k;
  // An input seek is measured from the container start and lands on the last
  // keyframe at or before it. Seeking to the declared start therefore selects the
  // keyframe that holds it — the one a player decodes first — while the entry
  // point sits below that keyframe by up to 256 ticks and would step back one.
  const copySeekSeconds = seekSeconds;
  const copyDurationSeconds = exportDuration + (copyHeadroom45k ?? 0) / 45_000;
  let copyRefusal = copyRequested ? copyRefusalReason(videoStream, colorPlan, copyHeadroom45k, codec) : undefined;
  let videoMode: VideoExportMode = copyRequested && copyRefusal === undefined ? "copy" : "encode";
  const warnings: MediaWarning[] = [...colorPlan.warnings];
  if (copyRefusal !== undefined) warnings.push({ code: "MEDIA_REMUX_UNAVAILABLE", message: `Video stream copy was not used: ${copyRefusal}. The clip is encoded instead.` });
  await mkdir(mediaDirectory, { recursive: true });

  const backgroundAbsolute = resolve(output, backgroundPath);
  const created: string[] = [];
  const reportBackground = (progress: MediaProcessProgress) => options.onProgress?.({ ...progress, assetPath: backgroundPath, durationSeconds: exportDuration, source: { playlistId: input.playlistId, playItemIndex: input.playItemIndex, clipId: input.clipId, kind: "background", pid: input.videoPid, videoMode } });
  const audioOutputs = input.audioTracks.map((track, index) => {
    const relativePath = `${assetDirectory}/audio-${track.pid.toString(16).padStart(4, "0")}-${safeLanguage(track.language)}.m4a`;
    const sourceStream = audioStreams[index]!;
    const pidMatchCount = sourceProbe.streams?.filter((stream) => stream.codec_type === "audio" && parseStreamId(stream.id) === track.pid).length ?? 0;
    return {
      track,
      relativePath,
      absolutePath: resolve(output, relativePath),
      inputSpecifier: pidMatchCount > 1 ? indexedStreamSpecifier(sourceStream, track.pid, input.sourcePath) : pidSpecifier(track.pid),
    };
  });
  const audioStartSeconds = videoMode === "copy" ? 0 : seekSeconds;
  const audioArgs = audioOutputs.flatMap(({ track, absolutePath, inputSpecifier }) => [
    ...(audioStartSeconds > 0.000001 ? ["-ss", String(audioStartSeconds)] : []),
    "-map", inputSpecifier, "-vn", "-sn", "-dn", "-t", String(exportDuration),
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
    "-metadata:s:a:0", `language=${safeLanguage(track.language)}`, "-f", "ipod", absolutePath,
  ]);
  try {
    created.push(backgroundAbsolute);
    for (const { absolutePath } of audioOutputs) created.push(absolutePath);
    let background: { duration: number; width: number; height: number } | undefined;
    let audioWritten = false;
    if (videoMode === "copy") {
      try {
        await runWithBudget(ffmpeg, [
          "-hide_banner", "-nostdin", "-loglevel", "error", "-progress", "pipe:2", "-stats_period", "1", "-n",
          ...(copySeekSeconds > 0 ? ["-ss", String(copySeekSeconds)] : []), "-i", input.sourcePath,
          "-map", pidSpecifier(input.videoPid), "-an", "-sn", "-dn", "-t", String(copyDurationSeconds),
          "-c:v", "copy", ...(videoStream.codec_name === "hevc" ? ["-tag:v", "hvc1"] : []), "-movflags", "+faststart", "-metadata:s:v:0", "language=und", "-f", "mp4", backgroundAbsolute,
          ...audioArgs,
        ], timeoutMs, [backgroundAbsolute, ...audioOutputs.map(({ absolutePath }) => absolutePath)], options.maxAssetBytes, invoke, options.signal, reportBackground);
        audioWritten = audioOutputs.length > 0;
        const copiedProbe = await probeEncodedOutput(ffprobe, backgroundAbsolute, timeoutMs, invoke);
        try { background = verifyCopiedVideo(copiedProbe, videoStream, aspectRatio, copyDurationSeconds, backgroundPath); }
        catch (error) { throw outputInvalid(backgroundAbsolute, ffprobe, error); }
      } catch (error) {
        if (!(error instanceof MediaJobError) || error.diagnostic.code !== "MEDIA_OUTPUT_INVALID") throw error;
        await unlink(backgroundAbsolute).catch(() => undefined);
        copyRefusal = errorText(error);
        videoMode = "encode";
        warnings.push({ code: "MEDIA_REMUX_UNAVAILABLE", message: `Copied video was discarded after verification and the clip is encoded instead: ${copyRefusal}` });
      }
    }
    if (background === undefined) {
      assertEstimateWithinLimit({ scope: "asset", estimateBytes: BigInt(estimate.videoBytes), limitBytes: options.maxAssetBytes, message: `Estimated media asset '${backgroundPath}' exceeds maxAssetBytes before encoding.` });
      await runWithBudget(ffmpeg, [
        "-hide_banner", "-nostdin", "-loglevel", "error", "-progress", "pipe:2", "-stats_period", "1", "-n", "-i", input.sourcePath,
        "-ss", String(seekSeconds), "-map", pidSpecifier(input.videoPid), "-an", "-sn", "-dn", "-t", String(exportDuration),
        "-vf", colorPlan.videoFilter, ...videoEncoderArgs(colorPlan, codec, crf, preset), "-aspect", aspectRatio, "-fps_mode", "passthrough",
        "-movflags", "+faststart", "-metadata:s:v:0", "language=und", "-f", "mp4", backgroundAbsolute,
        ...(audioWritten ? [] : audioArgs),
      ], timeoutMs, [backgroundAbsolute, ...audioOutputs.map(({ absolutePath }) => absolutePath)], options.maxAssetBytes, invoke, options.signal, reportBackground);
      const backgroundProbe = await probeEncodedOutput(ffprobe, backgroundAbsolute, timeoutMs, invoke);
      try {
        const stream = requireOneStream(backgroundProbe, "video", backgroundAbsolute);
        if (!positive(stream.width) || !positive(stream.height) || stream.width % 2 !== 0 || stream.height % 2 !== 0) throw new Error(`Encoded background video '${backgroundPath}' failed even-dimension verification.`);
        assertEncodedColor(stream, colorPlan, codec, backgroundPath);
        if (!sameAspectRatio(displayAspectRatio(stream), aspectRatio)) throw new Error(`Encoded background video '${backgroundPath}' display aspect ratio differs from source ratio ${aspectRatio}.`);
        const duration = streamDuration(stream, backgroundProbe);
        assertDuration(duration, exportDuration, backgroundPath);
        background = { duration, width: stream.width, height: stream.height };
      } catch (error) { throw outputInvalid(backgroundAbsolute, ffprobe, error); }
    }
    const videoDuration = background.duration;
    const expectedDuration = exportDuration;
    const backgroundStat = await stat(backgroundAbsolute);

    const audioTracks: Array<ExportedMediaAsset & { language: string; durationSeconds: number }> = [];
    const files = [{ path: backgroundPath, absolutePath: backgroundAbsolute, byteLength: backgroundStat.size }];
    for (const { track, relativePath, absolutePath } of audioOutputs) {
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

    const outputCodec: VideoCodec = videoMode === "copy" ? (videoStream.codec_name === "hevc" ? "hevc" : "h264") : codec;
    const encoding: MenuLoopEncoding = { mode: videoMode, codec: outputCodec, crf, preset, color: colorPlan };
    const plan = makePlan(input, estimate, existingOutputBytes, options.maxAssetBytes ?? null, encoding, false, [
      ...(videoMode === "copy" ? [`The background video is a bit-exact copy of the source ${videoStream.codec_name === "hevc" ? "HEVC" : "H.264"} stream; only its dimensions, colour signalling, and duration are verified.`] : []),
      ...(copyRefusal === undefined ? [] : [`Video stream copy is unavailable for this clip: ${copyRefusal}`]),
    ], { background: backgroundPath, audioTracks: audioOutputs.map(({ relativePath }) => relativePath) });
    created.push(planAbsolute);
    const planText = `${JSON.stringify(plan, null, 2)}\n`;
    await writeFile(planAbsolute, planText, { flag: "wx" });
    const wroteBytes = files.reduce((total, file) => total + BigInt(file.byteLength), 0n) + BigInt(Buffer.byteLength(planText));
    const actualOutputBytes = existingOutputBytes + wroteBytes;
    const outputSize = { beforeBytes: existingOutputBytes.toString(), afterBytes: actualOutputBytes.toString() };
    return {
      plan, outputSize, tools: { ffmpeg: ffmpegVersion, ffprobe: ffprobeVersion, invocations },
      background: { path: backgroundPath, absolutePath: backgroundAbsolute, byteLength: backgroundStat.size, codec: outputCodec, pid: input.videoPid, width: background.width, height: background.height, durationSeconds: videoDuration, loop: loopBackground(input), ...(loopStartSeconds === undefined ? {} : { loopStartSeconds }) },
      audioTracks, files, warnings,
    };
  } catch (error) {
    await Promise.all(created.map((path) => unlink(path).catch(() => undefined)));
    throw error;
  }
}

async function reuseMenuLoopMedia(input: MenuLoopMediaInput, options: MenuLoopMediaOptions, sourceDirectory: string, output: string, mediaDirectory: string, planPath: string, prior: { assetDirectory: string; planPath: string } | undefined, encoding: ReuseEncoding, probe: ReuseProbe): Promise<MenuLoopMediaResult | null> {
  const assetDirectory = normalizePackageDirectory(options.assetDirectory ?? "assets/media");
  const priorDirectory = prior?.assetDirectory ?? assetDirectory;
  const priorPlanPath = prior?.planPath ?? planPath;
  const priorPlan = await readPriorPlan(resolve(sourceDirectory, priorPlanPath));
  if (priorPlan === null || !matchesReusablePlan(priorPlan, input, encoding)) return null;
  const priorManifest = await readPriorManifest(sourceDirectory);
  const media = priorManifest === null ? await probePriorManifest(sourceDirectory, input, priorDirectory, priorPlan, probe) : packagedMediaFor(priorManifest, input);
  if (media === null) return null;
  const reusableEncoding: MenuLoopEncoding = { mode: priorPlan.encoding.video.mode, codec: encoding.codec, crf: encoding.crf, preset: encoding.preset, color: priorPlan.encoding.video.color };
  const priorBackground = media.background;
  const priorAudioTracks = media.audioTracks;
  const priorBackgroundPath = safePriorPath(priorBackground?.path) ?? safePriorPath(priorPlan.assetPaths?.background) ?? `${priorDirectory}/background.mp4`;
  const backgroundPath = `${assetDirectory}/background.mp4`;
  if (!priorBackground || priorBackground.path !== priorBackgroundPath || priorBackground.codec !== encoding.codec || priorBackground.pid !== input.videoPid
    || !positive(priorBackground.width) || !positive(priorBackground.height)
    || typeof priorBackground.durationSeconds !== "number" || !Number.isFinite(priorBackground.durationSeconds)
    || priorBackground.loop !== loopBackground(input) || !Array.isArray(priorAudioTracks) || priorAudioTracks.length !== input.audioTracks.length) return null;
  const audioRecords = input.audioTracks.map((track, index) => {
    const name = `audio-${track.pid.toString(16).padStart(4, "0")}-${safeLanguage(track.language)}.m4a`;
    const previous = priorAudioTracks.find((candidate) => candidate.pid === track.pid && candidate.streamNumber === track.streamNumber && candidate.language === track.language && candidate.codec === "aac");
    const priorPath = safePriorPath(previous?.path) ?? safePriorPath(priorPlan.assetPaths?.audioTracks[index]) ?? `${priorDirectory}/${name}`;
    if (previous && previous.path !== priorPath) return null;
    if (!previous || typeof previous.durationSeconds !== "number" || !Number.isFinite(previous.durationSeconds)) return null;
    return { track, priorPath, path: `${assetDirectory}/${name}`, previous };
  });
  if (audioRecords.some((record) => record === null)) return null;
  const transfers = [
    { source: priorBackgroundPath, destination: backgroundPath },
    ...audioRecords.map((record) => ({ source: record!.priorPath, destination: record!.path })),
  ];
  const sourceSizes = new Map<string, number>();
  try {
    for (const { source } of transfers) {
      const info = await stat(resolve(sourceDirectory, source));
      if (!info.isFile()) return null;
      sourceSizes.set(source, info.size);
    }
  } catch { return null; }

  validateOptionalByteLimit("maxAssetBytes", options.maxAssetBytes);
  const rates: MenuLoopBudgetRates = {
    estimatedVideoBitsPerSecond: options.estimatedVideoBitsPerSecond ?? 8_000_000,
    estimatedAudioBitsPerSecond: options.estimatedAudioBitsPerSecond ?? 192_000,
    containerOverheadPercent: options.containerOverheadPercent ?? 5,
  };
  validateBudgetRates(rates);
  const reuseStart45k = input.includeIntro ? input.inTime45k : input.loopStart45k ?? input.inTime45k;
  // The span stays in 45 kHz ticks; a seconds round trip can land one tick short.
  const estimate = estimateMenuLoopBudget(input.outTime45k - reuseStart45k, input.audioTracks.length, rates);
  for (const { source } of transfers) assertActualWithinLimit({ scope: "asset", actualBytes: BigInt(sourceSizes.get(source)!), limitBytes: options.maxAssetBytes, message: `Reused media asset '${source}' exceeds maxAssetBytes.` });
  const existingOutputBytes = await directoryBytesExcluding(output, resolve(input.sourcePath));
  await mkdir(mediaDirectory, { recursive: true });
  const copied: string[] = [];
  try {
    for (const { source, destination } of transfers) {
      const target = resolve(output, destination);
      await ensureAbsent(target);
      await copyFile(resolve(sourceDirectory, source), target);
      copied.push(target);
    }
    const plan = makePlan(input, estimate, existingOutputBytes, options.maxAssetBytes ?? null, reusableEncoding, true, [], {
      background: backgroundPath,
      audioTracks: audioRecords.map((record) => record!.path),
    });
    const files = transfers.map(({ destination, source }) => ({ path: destination, absolutePath: resolve(output, destination), byteLength: sourceSizes.get(source)! }));
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
    // A reused clip is finished before it starts. Reporting it keeps the plan's
    // progress in step with the clip counter instead of leaving the bar parked at
    // the reused fraction while the remaining clips encode.
    options.onProgress?.({ state: "end", outTimeSeconds: priorBackground.durationSeconds, durationSeconds: priorBackground.durationSeconds, assetPath: backgroundPath, source: { playlistId: input.playlistId, playItemIndex: input.playItemIndex, clipId: input.clipId, kind: "background", pid: input.videoPid, videoMode: reusableEncoding.mode, reused: true } });
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

interface ReuseProbe { readonly invoke: MediaProcessRunner; readonly ffprobe: string; readonly timeoutMs: number }

type StoredVideoEncoding = Omit<MediaPlan["encoding"]["video"], "mode"> & { mode?: VideoExportMode };
type StoredPlan = Omit<MediaPlan, "encoding"> & { encoding: Omit<MediaPlan["encoding"], "video"> & { video: StoredVideoEncoding } };

async function readPriorPlan(path: string): Promise<MediaPlan | null> {
  let stored: StoredPlan;
  try { stored = JSON.parse(await readFile(path, "utf8")) as StoredPlan; } catch { return null; }
  const video: MediaPlan["encoding"]["video"] = { ...stored.encoding.video, mode: stored.encoding.video.mode ?? "encode" };
  return { ...stored, encoding: { ...stored.encoding, video } };
}

async function readPriorManifest(sourceDirectory: string): Promise<Record<string, unknown> | null> {
  try { return JSON.parse(await readFile(resolve(sourceDirectory, "asset-manifest.json"), "utf8")) as Record<string, unknown>; } catch { return null; }
}

/** One encoded media unit as the package manifests record it. */
type PriorPackagedMedia = {
  plan?: { playlistId?: string; playItemIndex?: number };
  background?: Record<string, unknown>;
  audioTracks?: Array<Record<string, unknown>>;
};

/**
 * The packaged record a manifest indexes for one PlayItem.
 *
 * `media` and `menuMedia` list each PlayItem once as
 * `{ playlistId, playItemIndex, planPath }`; the plan's own record — plan,
 * background, audio tracks — sits once per encoded unit in `mediaPlans`, because
 * a menu playlist can point hundreds of PlayItems at one encoded unit.
 */
function packagedMediaFor(manifest: Record<string, unknown>, input: MenuLoopMediaInput): PriorPackagedMedia | null {
  const plans: Record<string, unknown> = isRecordValue(manifest.mediaPlans) ? manifest.mediaPlans : {};
  const listed: unknown[] = Array.isArray(manifest.menuMedia) ? manifest.menuMedia as unknown[] : [];
  const pointers: unknown[] = [manifest.media, ...listed];
  const pointer = pointers.find((candidate) => isRecordValue(candidate) && candidate.playlistId === input.playlistId && (candidate.playItemIndex ?? 0) === input.playItemIndex);
  const record = isRecordValue(pointer) && typeof pointer.planPath === "string" ? plans[pointer.planPath] : undefined;
  return isRecordValue(record) ? record : null;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Manifest facts for a directory that has none.
 *
 * A committed package records stream identity and duration in `asset-manifest.json`.
 * A run that stopped before its commit leaves the media plan beside its assets, so
 * those facts are read back from the files. Each asset must hold one stream of the
 * planned kind and match the plan's duration, which keeps a partly written file out
 * of the reuse path and sends that clip back through the encoder.
 */
async function probePriorManifest(sourceDirectory: string, input: MenuLoopMediaInput, assetDirectory: string, planned: MediaPlan, probe: ReuseProbe): Promise<PriorPackagedMedia | null> {
  const backgroundPath = safePriorPath(planned.assetPaths?.background) ?? `${assetDirectory}/background.mp4`;
  try {
    const backgroundProbe = await probeEncodedOutput(probe.ffprobe, resolve(sourceDirectory, backgroundPath), probe.timeoutMs, probe.invoke);
    const background = requireOneStream(backgroundProbe, "video", backgroundPath);
    if (!positive(background.width) || !positive(background.height)) return null;
    const backgroundDuration = streamDuration(background, backgroundProbe);
    assertDuration(backgroundDuration, planned.durationSeconds, backgroundPath);
    const audioTracks: Array<Record<string, unknown>> = [];
    for (const [index, track] of input.audioTracks.entries()) {
      const path = safePriorPath(planned.assetPaths?.audioTracks[index]) ?? `${assetDirectory}/audio-${track.pid.toString(16).padStart(4, "0")}-${safeLanguage(track.language)}.m4a`;
      const audioProbe = await probeEncodedOutput(probe.ffprobe, resolve(sourceDirectory, path), probe.timeoutMs, probe.invoke);
      const audio = requireOneStream(audioProbe, "audio", path);
      const duration = streamDuration(audio, audioProbe);
      assertDuration(duration, planned.durationSeconds, path);
      audioTracks.push({ path, codec: audio.codec_name, pid: track.pid, streamNumber: track.streamNumber, language: track.language, durationSeconds: duration });
    }
    return {
      plan: { playlistId: planned.playlistId, playItemIndex: planned.playItemIndex },
      background: { path: backgroundPath, codec: background.codec_name, pid: planned.videoPid, width: background.width, height: background.height, durationSeconds: backgroundDuration, loop: loopBackground(input) },
      audioTracks,
    };
  } catch { return null; }
}

function matchesReusablePlan(plan: MediaPlan, input: MenuLoopMediaInput, encoding: ReuseEncoding): boolean {
  const loop = loopBackground(input);
  const mode = input.stillMode === 2 ? "still-last-frame" : loop ? "loop-one-clip" : "single-clip";
  return plan.playlistId === input.playlistId && plan.playItemIndex === input.playItemIndex && plan.clipId === input.clipId
    && plan.sourceFile === input.sourceFile && plan.sourceIn45k === input.inTime45k && plan.sourceOut45k === input.outTime45k
    && plan.loopStart45k === input.loopStart45k && plan.includeIntro === input.includeIntro && plan.repeatCount === input.repeatCount && plan.backgroundMode === mode
    && plan.videoPid === input.videoPid && plan.encoding?.video?.codec === encoding.codec && plan.encoding.video.preset === encoding.preset && plan.encoding.video.crf === encoding.crf
    && plan.encoding.video.color?.policy === encoding.hdrMode
    && plan.encoding.video.mode === encoding.videoMode
    && plan.audioTracks.length === input.audioTracks.length && plan.audioTracks.every((track, index) => {
      const current = input.audioTracks[index]!;
      return track.streamNumber === current.streamNumber && track.pid === current.pid && track.language === current.language;
    });
}

export function pidSpecifier(pid: number): string { validatePid(pid); return `0:i:0x${pid.toString(16)}`; }

/**
 * Entry-point times have a 256-tick grid at 45 kHz (`coarse << 18 | fine << 8`),
 * so the recorded PTS is the frame's presentation time floored by up to
 * 5.689 ms. A start inside that window is that frame.
 */
const ENTRY_POINT_QUANTUM_45K = 256;

function copyRefusalReason(stream: ProbeStream, plan: VideoColorPlan, headroom45k: number | undefined, _codec: VideoCodec): string | undefined {
  if (stream.codec_name !== "h264" && stream.codec_name !== "hevc") return `the source video is ${stream.codec_name ?? "an unknown codec"}`;
  if (plan.filterChain !== "passthrough") return `the colour plan needs the ${plan.filterChain} pipeline`;
  if (stream.codec_name === "h264") {
    const bitDepth = pixelFormatBitDepth(stream.pix_fmt);
    if (bitDepth !== 8 || stream.pix_fmt?.includes("420") !== true) return `the source pixel format is ${stream.pix_fmt ?? "unknown"}`;
  }
  if (!positive(stream.width) || !positive(stream.height) || stream.width % 2 !== 0 || stream.height % 2 !== 0) return `the source frame is ${stream.width ?? "?"}x${stream.height ?? "?"}`;
  if (headroom45k === undefined) return "the clip entry point for the segment is unknown";
  if (headroom45k < 0) return `the segment starts ${(-headroom45k / 45_000).toFixed(3)}s before its clip entry point`;
  if (headroom45k > ENTRY_POINT_QUANTUM_45K) return `the segment starts ${(headroom45k / 45_000).toFixed(3)}s after the covering keyframe`;
  return undefined;
}

function verifyCopiedVideo(probe: ProbeResult, source: ProbeStream, aspectRatio: string, expectedDuration: number, path: string): { duration: number; width: number; height: number } {
  const stream = requireOneStream(probe, "video", path);
  if (stream.codec_name !== source.codec_name) throw new Error(`Copied video '${path}' uses codec ${stream.codec_name ?? "unknown"}; expected ${source.codec_name ?? "unknown"}.`);
  if (!positive(stream.width) || !positive(stream.height) || stream.width % 2 !== 0 || stream.height % 2 !== 0) throw new Error(`Copied video '${path}' failed even-dimension verification.`);
  const width = stream.width;
  const height = stream.height;
  if (!sameAspectRatio(displayAspectRatio(stream), aspectRatio)) throw new Error(`Copied video '${path}' display aspect ratio differs from source ratio ${aspectRatio}.`);
  for (const [field, actual, expected] of [
    ["color_primaries", stream.color_primaries, source.color_primaries],
    ["color_transfer", stream.color_transfer, source.color_transfer],
    ["color_space", stream.color_space, source.color_space],
  ] as const) {
    if (normalizeColorTag(actual) !== normalizeColorTag(expected)) throw new Error(`Copied video '${path}' changed ${field} from ${normalizeColorTag(expected) ?? "unspecified"} to ${normalizeColorTag(actual) ?? "unspecified"}.`);
  }
  const duration = streamDuration(stream, probe);
  assertDuration(duration, expectedDuration, path);
  return { duration, width, height };
}

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
function firstLine(value: string): string { return value.split(/\r?\n/, 1)[0] ?? "unknown"; }
async function probeEncodedOutput(ffprobe: string, path: string, timeoutMs: number, run: MediaProcessRunner): Promise<ProbeResult> {
  const args = probeArgs(path);
  const response = await run(ffprobe, args, timeoutMs);
  try { return parseProbe(response.stdout, path, "ffprobe returned invalid stream metadata for"); }
  catch (error) { throw outputInvalid(path, ffprobe, error); }
}
function outputInvalid(path: string, ffprobe: string, error: unknown): MediaJobError {
  const message = `Encoded output '${path}' failed FFprobe validation: ${errorText(error)}`;
  return new MediaJobError({ code: "MEDIA_OUTPUT_INVALID", executable: ffprobe, args: probeArgs(path), message });
}
function findPidStream(probe: ProbeResult, pid: number, type: string, subject: string, codingType?: number): ProbeStream {
  const matches = probe.streams?.filter((stream) => stream.codec_type === type && parseStreamId(stream.id) === pid) ?? [];
  if (matches.length === 0) throw new Error(`Clip media '${subject}' has no ${type} stream for declared PID ${pid}.`);
  if (matches.length === 1) return matches[0]!;

  const codecs = type === "audio" && codingType !== undefined ? audioCodecsForCodingType(codingType) : undefined;
  const selected = codecs === undefined ? [] : matches.filter((stream) => stream.codec_name !== undefined && codecs.has(stream.codec_name));
  if (selected.length === 1) return selected[0]!;
  const found = matches.map((stream) => `${stream.codec_name ?? "unknown"} (index ${stream.index ?? "unknown"})`).join(", ");
  const expected = codecs === undefined ? "a stream matching the declared coding type" : [...codecs].join(" or ");
  throw new Error(`Clip media '${subject}' has ${matches.length} ${type} streams for PID ${pid} (${found}); expected one ${expected} stream for coding type ${codingType === undefined ? "unknown" : `0x${codingType.toString(16)}`}.`);
}

function audioCodecsForCodingType(codingType: number): ReadonlySet<string> | undefined {
  switch (codingType) {
    case 0x01: return new Set(["mp1"]);
    case 0x02: return new Set(["mp2"]);
    case 0x03: return new Set(["mp1", "mp2"]);
    case 0x04: return new Set(["mp2"]);
    case 0x80: return new Set(["pcm_bluray"]);
    case 0x81: return new Set(["ac3"]);
    case 0x82:
    case 0x85:
    case 0x86:
    case 0xa2: return new Set(["dts"]);
    case 0x83: return new Set(["truehd"]);
    case 0x84:
    case 0xa1: return new Set(["eac3"]);
    default: return undefined;
  }
}

function indexedStreamSpecifier(stream: ProbeStream, pid: number, subject: string): string {
  if (!Number.isSafeInteger(stream.index) || stream.index! < 0) {
    throw new Error(`Clip media '${subject}' has multiple streams for PID ${pid}, but ffprobe did not report a valid stream index for the selected audio stream.`);
  }
  return `0:${stream.index}`;
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

export { runMediaProcess } from "./process/process.js";

function normalizePackageDirectory(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").some((part) => part === "" || part === "." || part === "..")) throw new RangeError(`assetDirectory must be a package-relative directory, received '${value}'.`);
  return normalized;
}

function normalizePackagePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").some((part) => part === "" || part === "." || part === "..")) throw new RangeError(`planPath must be a package-relative file path, received '${value}'.`);
  return normalized;
}

function safePriorPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try { return normalizePackagePath(value); } catch { return undefined; }
}

function makePlan(input: MenuLoopMediaInput, estimate: MenuLoopBudgetEstimate, existingOutputBytes: bigint, maxAssetBytes: number | null, encoding: MenuLoopEncoding, reused = false, notes: readonly string[] = [], assetPaths?: MediaPlan["assetPaths"]): MediaPlan {
  const fallback = encoding.color.filterChain === "hdr-passthrough-fallback";
  const hdrWithoutHevc = encoding.codec === "h264" && encoding.color.output.bitDepth === 10;
  return {
    status: "partial", playlistId: input.playlistId, playItemIndex: input.playItemIndex, clipId: input.clipId,
    sourceFile: input.sourceFile, sourceIn45k: input.inTime45k, sourceOut45k: input.outTime45k,
    ...(input.loopStart45k !== undefined ? { loopStart45k: input.loopStart45k } : {}), ...(input.includeIntro ? { includeIntro: true } : {}),
    durationSeconds: durationSeconds(input), repeatCount: input.repeatCount,
    backgroundMode: input.stillMode === 2 ? "still-last-frame" : loopBackground(input) ? "loop-one-clip" : "single-clip", videoPid: input.videoPid,
    audioTracks: input.audioTracks.map((track) => ({ ...track })),
    ...(assetPaths ? { assetPaths } : {}),
    encoding: {
      video: {
        mode: encoding.mode,
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
      ...notes,
      reused ? "Encoded assets are reused from a prior package when its media plan matches; source content changes at the same path are not fingerprinted." : "On overwrite, prior media assets are reused when playlist, clip, time bounds, stream declarations, and encoding settings match; source content changes at the same path are not fingerprinted.",
    ],
  };
}

async function runWithBudget(executable: string, args: string[], timeoutMs: number, assetPaths: readonly string[], maxAssetBytes: number | null | undefined, run: MediaProcessRunner, externalSignal?: AbortSignal, onProgress?: (progress: MediaProcessProgress) => void): Promise<MediaProcessResult> {
  return runMonitoredProcess({
    run: (signal) => run(executable, args, timeoutMs, signal, onProgress),
    check: async (phase) => {
      for (const assetPath of assetPaths) assertActualWithinLimit({ scope: "asset", actualBytes: await fileBytes(assetPath), limitBytes: maxAssetBytes, message: `Encoded media asset '${assetPath}' exceeded maxAssetBytes ${phase}.` });
    },
    ...(externalSignal ? { signal: externalSignal } : {}),
    cancellationError: () => new MediaJobError({ code: "MEDIA_JOB_CANCELLED", executable, args: [...args], message: `Media job '${executable}' was cancelled.` }),
    monitorError: (error) => error instanceof Error ? error : new Error("Media asset monitoring failed.", { cause: error }),
  });
}
