import { spawn } from "node:child_process";
import { access, mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { parsePgsSup } from "./pgs.js";
import { assertActualWithinLimit, assertEstimateWithinLimit, estimateMenuLoopBudget, validateBudgetRates, validateOptionalByteLimit, type MenuLoopBudgetEstimate, type MenuLoopBudgetRates, MediaBudgetError } from "./budget.js";

export * from "./closure.js";
export * from "./external-targets.js";
export * from "./media-plan.js";
export * from "./timeline.js";
export * from "./seek.js";
export * from "./linear.js";
export * from "./budget.js";
export * from "./pgs.js";

export interface ExtractedPgsTrack { pid: number; sourcePath: string; path: string; byteLength: number; displaySets: ReturnType<typeof parsePgsSup>; }

/** Extract one declared Blu-ray PGS PID as SUP, then parse and validate every display set. */
export async function extractPgsTrack(sourcePath: string, pid: number, outputPath: string, options: { ffmpegPath?: string; timeoutMs?: number; runProcess?: MediaProcessRunner; maxBytes?: number } = {}): Promise<ExtractedPgsTrack> {
  if (!Number.isSafeInteger(pid) || pid < 0x20 || pid > 0x1ffe) throw new RangeError("PGS PID must be a valid 13-bit transport PID.");
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError("maxBytes must be a positive safe integer.");
  const output = resolve(outputPath);
  await mkdir(resolve(output, ".."), { recursive: true });
  const args = ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", resolve(sourcePath), "-map", `0:i:0x${pid.toString(16)}`, "-c:s", "copy", "-f", "sup", output];
  await (options.runProcess ?? runProcess)(options.ffmpegPath ?? "ffmpeg", args, options.timeoutMs ?? 5 * 60 * 1000);
  const bytes = new Uint8Array(await readFile(output));
  if (bytes.byteLength > maxBytes) { await unlink(output).catch(() => undefined); throw new RangeError(`Extracted PGS PID ${pid} exceeds maxBytes.`); }
  try {
    const displaySets = parsePgsSup(bytes);
    if (displaySets.length === 0) throw new TypeError(`Extracted PGS PID ${pid} contains no complete display sets.`);
    return { pid, sourcePath: resolve(sourcePath), path: output, byteLength: bytes.byteLength, displaySets };
  } catch (error) {
    await unlink(output).catch(() => undefined);
    throw error;
  }
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
  outTime45k: number;
  stillMode: number;
  repeatCount: number;
  videoPid: number;
  audioTracks: MediaAudioTrackInput[];
}
export interface MediaProcessResult { stdout: string; stderr: string; }
export type MediaProcessRunner = (executable: string, args: string[], timeoutMs: number, signal?: AbortSignal) => Promise<MediaProcessResult>;
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
  ffmpegPath?: string;
  ffprobePath?: string;
  timeoutMs?: number;
  crf?: number;
  preset?: "medium" | "fast" | "veryfast" | "ultrafast";
  /** Maximum bytes for one encoded media asset. Null disables the per-asset cap. */
  maxAssetBytes?: number | null;
  /** Maximum bytes in the complete output directory, including existing package files and media-plan.json. */
  maxOutputBytes?: number | null;
  estimatedVideoBitsPerSecond?: number;
  estimatedAudioBitsPerSecond?: number;
  containerOverheadPercent?: number;
  signal?: AbortSignal;
  runProcess?: MediaProcessRunner;
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
  durationSeconds: number;
  repeatCount: number;
  backgroundMode: "loop-one-clip" | "still-last-frame";
  videoPid: number;
  audioTracks: MediaAudioTrackInput[];
  encoding: {
    video: { codec: "h264"; pixelFormat: "yuv420p"; preset: string; crf: number; aspectRatioPolicy: "preserve-source-display-aspect"; frameRatePolicy: "passthrough"; evenDimensions: true };
    audio: { codec: "aac"; bitrate: "192k" };
    container: { video: "mp4"; audio: "m4a"; faststart: true };
  };
  budget: MenuLoopBudgetEstimate & { existingOutputBytes: string; plannedPackageBytes: string; maxAssetBytes: number | null; maxOutputBytes: number | null };
  limitations: string[];
}
export interface ExportedMediaAsset { path: string; absolutePath: string; byteLength: number; codec: "h264" | "aac"; pid: number; streamNumber?: number; language?: string; }
export interface MenuLoopMediaResult {
  plan: MediaPlan;
  tools: { ffmpeg: string; ffprobe: string; invocations: MediaToolInvocation[] };
  background: ExportedMediaAsset & { width: number; height: number; durationSeconds: number; loop: boolean };
  audioTracks: Array<ExportedMediaAsset & { language: string; durationSeconds: number }>;
  files: Array<{ path: string; absolutePath: string; byteLength: number }>;
}

interface ProbeStream { index?: number; id?: string; codec_type?: string; codec_name?: string; width?: number; height?: number; display_aspect_ratio?: string; duration?: string; }
interface ProbeResult { streams?: ProbeStream[]; format?: { start_time?: string; duration?: string }; }

/** Export one validated menu-loop clip as a local video asset and per-track AAC files. */
export async function exportMenuLoopMedia(input: MenuLoopMediaInput, options: MenuLoopMediaOptions): Promise<MenuLoopMediaResult> {
  validateInput(input);
  if (!options.outputDirectory) throw new TypeError("outputDirectory is required");
  const timeoutMs = options.timeoutMs ?? 20 * 60 * 1000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RangeError("timeoutMs must be a positive safe integer");
  const crf = options.crf ?? 18;
  if (!Number.isInteger(crf) || crf < 0 || crf > 51) throw new RangeError("crf must be from 0 through 51");
  const preset = options.preset ?? "medium";
  const ffmpeg = options.ffmpegPath ?? "ffmpeg";
  const ffprobe = options.ffprobePath ?? "ffprobe";
  const run = options.runProcess ?? runProcess;
  const invocations: MediaToolInvocation[] = [];
  const invoke: MediaProcessRunner = async (executable, args, limit, signal) => {
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectTimeout: ((error: Error) => void) | undefined;
    const timeout = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
    const processPromise = run(executable, args, limit, controller.signal);
    timer = setTimeout(() => {
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
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      options.signal?.removeEventListener("abort", abort);
    }
  };
  const output = resolve(options.outputDirectory);
  const mediaDirectory = resolve(output, "assets/media");
  const planAbsolute = resolve(output, "media-plan.json");
  await ensureAbsent(planAbsolute);

  validateOptionalByteLimit("maxAssetBytes", options.maxAssetBytes);
  validateOptionalByteLimit("maxOutputBytes", options.maxOutputBytes);
  const rates: MenuLoopBudgetRates = {
    estimatedVideoBitsPerSecond: options.estimatedVideoBitsPerSecond ?? 8_000_000,
    estimatedAudioBitsPerSecond: options.estimatedAudioBitsPerSecond ?? 192_000,
    containerOverheadPercent: options.containerOverheadPercent ?? 5,
  };
  validateBudgetRates(rates);
  const estimate = estimateMenuLoopBudget(input.outTime45k - (input.loopStart45k ?? input.inTime45k), input.audioTracks.length, rates);
  const backgroundPath = "assets/media/background.mp4";
  const audioPaths = input.audioTracks.map((track) => `assets/media/audio-${track.pid.toString(16).padStart(4, "0")}-${safeLanguage(track.language)}.m4a`);
  for (const [path, bytes] of [[backgroundPath, estimate.videoBytes] as const, ...audioPaths.map((path, index) => [path, estimate.audioBytes[index]!] as const)]) {
    assertEstimateWithinLimit({ scope: "asset", estimateBytes: BigInt(bytes), limitBytes: options.maxAssetBytes, message: `Estimated media asset '${path}' exceeds maxAssetBytes before encoding.` });
    await ensureAbsent(resolve(output, path));
  }
  const existingOutputBytes = await directoryBytesExcluding(output, resolve(input.sourcePath));
  const mediaAndExistingBytes = existingOutputBytes + BigInt(estimate.totalMediaBytes);
  let estimatedPackageBytes = mediaAndExistingBytes;
  let provisionalPlan: MediaPlan;
  for (let pass = 0; pass < 4; pass++) {
    provisionalPlan = makePlan(input, estimate, existingOutputBytes, estimatedPackageBytes, options.maxAssetBytes ?? null, options.maxOutputBytes ?? null, crf, preset);
    const planBytes = BigInt(Buffer.byteLength(`${JSON.stringify(provisionalPlan, null, 2)}\n`));
    const nextEstimate = mediaAndExistingBytes + planBytes;
    if (nextEstimate === estimatedPackageBytes) break;
    estimatedPackageBytes = nextEstimate;
  }
  provisionalPlan = makePlan(input, estimate, existingOutputBytes, estimatedPackageBytes, options.maxAssetBytes ?? null, options.maxOutputBytes ?? null, crf, preset);
  // Include the final serialized plan size in the package estimate.
  estimatedPackageBytes = mediaAndExistingBytes + BigInt(Buffer.byteLength(`${JSON.stringify(provisionalPlan, null, 2)}\n`));
  assertEstimateWithinLimit({ scope: "package", estimateBytes: estimatedPackageBytes, limitBytes: options.maxOutputBytes, message: "Estimated complete output directory exceeds maxOutputBytes before encoding." });

  const ffmpegVersion = firstLine((await invoke(ffmpeg, ["-version"], timeoutMs)).stdout);
  const ffprobeVersion = firstLine((await invoke(ffprobe, ["-version"], timeoutMs)).stdout);
  const encoderArgs = ["-hide_banner", "-encoders"];
  const encoderList = await invoke(ffmpeg, encoderArgs, timeoutMs);
  const availableEncoders = `${encoderList.stdout}\n${encoderList.stderr}`;
  const missingEncoders = ["libx264", "aac"].filter((name) => !hasEncoder(availableEncoders, name));
  if (missingEncoders.length) throw new MediaToolError({
    code: "MEDIA_ENCODER_UNAVAILABLE", executable: ffmpeg, args: encoderArgs,
    message: `FFmpeg does not advertise required encoder${missingEncoders.length > 1 ? "s" : ""} ${missingEncoders.join(", ")}.`,
  });
  const sourceProbe = parseProbe((await invoke(ffprobe, probeArgs(input.sourcePath), timeoutMs)).stdout, input.sourcePath);
  const sourceStart = Number(sourceProbe.format?.start_time);
  if (!Number.isFinite(sourceStart)) throw new Error(`ffprobe did not report the source timeline start for '${input.sourcePath}'.`);
  const rawSeekSeconds = (input.loopStart45k ?? input.inTime45k) / 45_000 - sourceStart;
  const seekSeconds = rawSeekSeconds < 0.000001 ? 0 : rawSeekSeconds;
  const videoStream = findPidStream(sourceProbe, input.videoPid, "video", input.sourcePath);
  if (videoStream.codec_name !== "h264") throw new Error(`Menu loop Clip ${input.clipId} video PID ${input.videoPid} is ${videoStream.codec_name ?? "unknown"}; H.264 is required for this export.`);
  const audioStreams = input.audioTracks.map((track) => ({ track, stream: findPidStream(sourceProbe, track.pid, "audio", input.sourcePath) }));
  const aspectRatio = displayAspectRatio(videoStream);

  await mkdir(mediaDirectory, { recursive: true });

  const backgroundAbsolute = resolve(output, backgroundPath);
  const created: string[] = [];
  try {
    created.push(backgroundAbsolute);
    await runWithBudget(ffmpeg, [
      "-hide_banner", "-nostdin", "-loglevel", "error", "-n", "-i", input.sourcePath,
      "-ss", String(seekSeconds), "-map", pidSpecifier(input.videoPid), "-an", "-sn", "-dn", "-t", String(durationSeconds(input)),
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p", "-aspect", aspectRatio, "-fps_mode", "passthrough",
      "-movflags", "+faststart", "-metadata:s:v:0", "language=und", "-f", "mp4", backgroundAbsolute,
    ], timeoutMs, output, resolve(input.sourcePath), backgroundAbsolute, options.maxAssetBytes, options.maxOutputBytes, invoke, options.signal);
    const backgroundProbe = await probeEncodedOutput(ffprobe, backgroundAbsolute, timeoutMs, invoke);
    let outputVideo: ProbeStream;
    let videoDuration: number;
    try {
      outputVideo = requireOneStream(backgroundProbe, "video", backgroundAbsolute);
      if (outputVideo.codec_name !== "h264" || !positive(outputVideo.width) || !positive(outputVideo.height) || outputVideo.width % 2 !== 0 || outputVideo.height % 2 !== 0) throw new Error(`Encoded background video '${backgroundPath}' failed H.264/even-dimension verification.`);
      if (!sameAspectRatio(displayAspectRatio(outputVideo), aspectRatio)) throw new Error(`Encoded background video '${backgroundPath}' display aspect ratio differs from source ratio ${aspectRatio}.`);
      videoDuration = streamDuration(outputVideo, backgroundProbe);
      assertDuration(videoDuration, durationSeconds(input), backgroundPath);
    } catch (error) { throw outputInvalid(backgroundAbsolute, ffprobe, error); }
    const expectedDuration = durationSeconds(input);
    const backgroundStat = await stat(backgroundAbsolute);

    const audioTracks: Array<ExportedMediaAsset & { language: string; durationSeconds: number }> = [];
    const files = [{ path: backgroundPath, absolutePath: backgroundAbsolute, byteLength: backgroundStat.size }];
    for (const { track, stream } of audioStreams) {
      const stem = `audio-${track.pid.toString(16).padStart(4, "0")}-${safeLanguage(track.language)}`;
      const relativePath = `assets/media/${stem}.m4a`;
      const absolutePath = resolve(output, relativePath);
      created.push(absolutePath);
      await runWithBudget(ffmpeg, [
        "-hide_banner", "-nostdin", "-loglevel", "error", "-n", "-i", input.sourcePath,
        "-ss", String(seekSeconds), "-map", pidSpecifier(track.pid), "-vn", "-sn", "-dn", "-t", String(expectedDuration),
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
        "-metadata:s:a:0", `language=${safeLanguage(track.language)}`, "-f", "ipod", absolutePath,
      ], timeoutMs, output, resolve(input.sourcePath), absolutePath, options.maxAssetBytes, options.maxOutputBytes, invoke, options.signal);
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
      audioTracks.push({ ...asset, codec: "aac", pid: track.pid, streamNumber: track.streamNumber, language: track.language, durationSeconds: audioDuration });
    }

    const plan = makePlan(input, estimate, existingOutputBytes, estimatedPackageBytes, options.maxAssetBytes ?? null, options.maxOutputBytes ?? null, crf, preset);
    const finalPlanBytes = Buffer.byteLength(`${JSON.stringify(plan, null, 2)}\n`);
    const finalPackageBytes = await directoryBytesExcluding(output, resolve(input.sourcePath)) + BigInt(finalPlanBytes);
    assertActualWithinLimit({ scope: "package", actualBytes: finalPackageBytes, limitBytes: options.maxOutputBytes, message: "Complete output directory exceeds maxOutputBytes before media-plan.json is published." });
    created.push(planAbsolute);
    await writeFile(planAbsolute, `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx" });
    assertActualWithinLimit({ scope: "package", actualBytes: await directoryBytesExcluding(output, resolve(input.sourcePath)), limitBytes: options.maxOutputBytes, message: "Complete output directory exceeded maxOutputBytes while publishing media-plan.json." });
    return {
      plan, tools: { ffmpeg: ffmpegVersion, ffprobe: ffprobeVersion, invocations },
      background: { path: backgroundPath, absolutePath: backgroundAbsolute, byteLength: backgroundStat.size, codec: "h264", pid: input.videoPid, width: outputVideo.width!, height: outputVideo.height!, durationSeconds: videoDuration, loop: input.stillMode !== 2 },
      audioTracks, files,
    };
  } catch (error) {
    await Promise.all(created.map((path) => unlink(path).catch(() => undefined)));
    throw error;
  }
}

export function pidSpecifier(pid: number): string { validatePid(pid); return `0:i:0x${pid.toString(16)}`; }
export function durationSeconds(input: Pick<MenuLoopMediaInput, "inTime45k" | "outTime45k" | "loopStart45k">): number { return (input.outTime45k - (input.loopStart45k ?? input.inTime45k)) / 45_000; }
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
function firstLine(value: string): string { return value.split(/\r?\n/, 1)[0] ?? "unknown"; }
function probeArgs(path: string): string[] { return ["-v", "error", "-show_entries", "stream=index,id,codec_type,codec_name,width,height,display_aspect_ratio,duration:format=start_time,duration", "-of", "json", path]; }
function parseProbe(text: string, subject: string): ProbeResult {
  try {
    const value = JSON.parse(text) as ProbeResult;
    if (!Array.isArray(value.streams)) throw new Error("no streams array");
    return value;
  } catch (error) { throw new Error(`ffprobe returned invalid stream metadata for '${subject}': ${error instanceof Error ? error.message : String(error)}`); }
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
function positive(value: number | undefined): value is number { return Number.isSafeInteger(value) && value! > 0; }
async function ensureAbsent(path: string): Promise<void> {
  try { await access(path); throw new Error(`Media export target already exists: '${path}'.`); }
  catch (error) { if (error instanceof Error && error.message.startsWith("Media export target already exists:")) throw error; if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

async function runProcess(executable: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<MediaProcessResult> {
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
    child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
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

function makePlan(input: MenuLoopMediaInput, estimate: MenuLoopBudgetEstimate, existingOutputBytes: bigint, plannedPackageBytes: bigint, maxAssetBytes: number | null, maxOutputBytes: number | null, crf: number, preset: string): MediaPlan {
  return {
    status: "partial", playlistId: input.playlistId, playItemIndex: input.playItemIndex, clipId: input.clipId,
    sourceFile: input.sourceFile, sourceIn45k: input.inTime45k, sourceOut45k: input.outTime45k,
    ...(input.loopStart45k !== undefined ? { loopStart45k: input.loopStart45k } : {}),
    durationSeconds: durationSeconds(input), repeatCount: input.repeatCount, backgroundMode: input.stillMode === 2 ? "still-last-frame" : "loop-one-clip", videoPid: input.videoPid,
    audioTracks: input.audioTracks.map((track) => ({ ...track })),
    encoding: {
      video: { codec: "h264", pixelFormat: "yuv420p", preset, crf, aspectRatioPolicy: "preserve-source-display-aspect", frameRatePolicy: "passthrough", evenDimensions: true },
      audio: { codec: "aac", bitrate: "192k" },
      container: { video: "mp4", audio: "m4a", faststart: true },
    },
    budget: { ...estimate, existingOutputBytes: existingOutputBytes.toString(), plannedPackageBytes: plannedPackageBytes.toString(), maxAssetBytes, maxOutputBytes },
    limitations: [input.stillMode === 2 ? "This output covers the single infinite-still menu PlayItem and its declared audio tracks only; it does not represent the complete HDMV playlist timeline." : "This output covers the repeated menu background clip and its declared audio tracks only; it does not represent the complete HDMV playlist timeline.", "Multi-PlayItem linear precomposition and branch-specific feature media are unsupported by this menu-loop export contract.", "Persistent cache reuse is disabled because this export contract does not validate source-content identity.", "PGS subtitle streams are not exported by this background-loop path."],
  };
}

async function runWithBudget(executable: string, args: string[], timeoutMs: number, output: string, sourcePath: string, assetPath: string, maxAssetBytes: number | null | undefined, maxOutputBytes: number | null | undefined, run: MediaProcessRunner, externalSignal?: AbortSignal): Promise<MediaProcessResult> {
  const controller = new AbortController();
  let stopMonitor: (() => void) | undefined;
  let externalAbortHandler: (() => void) | undefined;
  const processPromise = run(executable, args, timeoutMs, controller.signal);
  const monitorPromise = new Promise<never>((_resolve, reject) => {
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const assetBytes = await pathBytes(assetPath);
        assertActualWithinLimit({ scope: "asset", actualBytes: assetBytes, limitBytes: maxAssetBytes, message: `Encoded media asset '${assetPath}' exceeded maxAssetBytes during encoding.` });
        const packageBytes = await directoryBytesExcluding(output, sourcePath);
        assertActualWithinLimit({ scope: "package", actualBytes: packageBytes, limitBytes: maxOutputBytes, message: `Output directory exceeded maxOutputBytes while encoding '${assetPath}'.` });
      } catch (error) {
        controller.abort();
        reject(error);
      } finally { checking = false; }
    };
    const timer = setInterval(() => { void check(); }, 10);
    stopMonitor = () => clearInterval(timer);
    void check();
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
    assertActualWithinLimit({ scope: "package", actualBytes: await directoryBytesExcluding(output, sourcePath), limitBytes: maxOutputBytes, message: `Output directory exceeded maxOutputBytes at process completion for '${assetPath}'.` });
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

async function directoryBytesExcluding(root: string, excludedPath: string): Promise<bigint> {
  let total = 0n;
  const visit = async (directory: string): Promise<void> => {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (path === excludedPath) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) total += BigInt((await stat(path)).size);
    }
  };
  await visit(root);
  return total;
}
