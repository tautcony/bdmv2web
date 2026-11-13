import type { MenuLoopBudgetEstimate } from "./budget.js";
import type { ColorWarning, ColorFilterChain, HdrMode, OutputColor, SourceColor, VideoCodec, VideoColorPlan } from "./color/color.js";

export interface MediaProcessResult { stdout: string; stderr: string; }
export interface MediaProcessProgress { outTimeSeconds: number; state: "continue" | "end"; }
export type MediaProcessRunner = (executable: string, args: string[], timeoutMs: number, signal?: AbortSignal, onProgress?: (progress: MediaProcessProgress) => void) => Promise<MediaProcessResult>;
export interface MediaToolInvocation { executable: string; args: string[]; }

export interface MediaAudioTrackInput { streamNumber: number; pid: number; language: string; }
/** How the background video reaches MP4: encoded here, or copied from the source stream. */
export type VideoExportMode = "encode" | "copy";
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
  /**
   * Presentation time (45 kHz) of the clip entry point at or before the export
   * start. A player seeks here, decodes, and drops everything before the declared
   * start, so a stream copy may begin here when the start names this entry point.
   */
  copyStart45k?: number;
  outTime45k: number;
  stillMode: number;
  repeatCount: number;
  /** Whether the declared menu segment repeats; ordinary single PlayItems play once. */
  loopBackground?: boolean;
  videoPid: number;
  audioTracks: MediaAudioTrackInput[];
}
/** The menu clip and stream whose encoding an asset progress report describes. */
export interface MediaAssetSource {
  playlistId: string;
  playItemIndex: number;
  clipId: string;
  kind: "background" | "audio";
  pid: number;
  language?: string;
  /**
   * Video pipeline in use for this background asset. A copy that fails
   * verification is re-encoded, so later reports for the same asset change
   * from `copy` to `encode`.
   */
  videoMode?: VideoExportMode;
  /** The clip was taken from a previous package instead of being exported again. */
  reused?: boolean;
}
/** One encoded asset's progress, named by package path and by its source stream. */
export type MediaAssetProgress = MediaProcessProgress & { assetPath: string; durationSeconds: number; source: MediaAssetSource };
export interface MenuLoopMediaOptions {
  outputDirectory: string;
  /** Reuse encoded assets only when the previous package media plan matches this input. */
  reuseFromDirectory?: string;
  /** Package-relative directory for this playlist's encoded video and audio. */
  assetDirectory?: string;
  /** Package-relative path for this playlist's media plan. */
  planPath?: string;
  /**
   * Older package-relative layouts to read reused assets from, tried in order
   * after `assetDirectory`/`planPath`. A renamed layout keeps its assets
   * reusable: the prior plan is read where it was written and its files are
   * copied to the current names.
   */
  reuseAlternatives?: ReadonlyArray<{ assetDirectory: string; planPath: string }>;
  ffmpegPath?: string;
  ffprobePath?: string;
  timeoutMs?: number;
  crf?: number;
  preset?: "medium" | "fast" | "veryfast" | "ultrafast";
  /** Output video encoder. Defaults to `hevc`. */
  codec?: VideoCodec;
  /** Dynamic-range policy for HDR sources. Defaults to `tonemap` (SDR BT.709). */
  hdrMode?: HdrMode;
  /**
   * `copy` writes the source H.264 or HEVC stream into MP4 without re-encoding it.
   * A copy requires an entry point no more than 256 ticks before the export
   * start, even dimensions, and SDR; H.264 additionally requires 8-bit 4:2:0. Other clips are encoded
   * and the plan records the reason. Defaults to `encode`.
   */
  videoMode?: VideoExportMode;
  /** Maximum bytes for one encoded media asset. Null disables the per-asset cap. */
  maxAssetBytes?: number | null;
  estimatedVideoBitsPerSecond?: number;
  estimatedAudioBitsPerSecond?: number;
  containerOverheadPercent?: number;
  signal?: AbortSignal;
  runProcess?: MediaProcessRunner;
  /** Reuse source metadata probes across clip exports in one package build. */
  sourceProbeCache?: Map<string, Promise<MediaProcessResult>>;
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
  assetPaths?: { background: string; audioTracks: string[] };
  encoding: {
    video: {
      /** `copy` keeps the source bitstream; `encode` runs the configured encoder. */
      mode: VideoExportMode;
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
/** A non-blocking export note: colour-pipeline advice or a refused stream copy. */
export type MediaWarning = ColorWarning | { code: "MEDIA_REMUX_UNAVAILABLE"; message: string };
export interface MenuLoopMediaResult {
  plan: MediaPlan;
  outputSize: { beforeBytes: string; afterBytes: string };
  tools: { ffmpeg: string; ffprobe: string; invocations: MediaToolInvocation[] };
  background: ExportedMediaAsset & { width: number; height: number; durationSeconds: number; loop: boolean; loopStartSeconds?: number };
  audioTracks: Array<ExportedMediaAsset & { language: string; durationSeconds: number; loopStartSeconds?: number }>;
  files: Array<{ path: string; absolutePath: string; byteLength: number }>;
  /** Colour-pipeline and stream-copy warnings that did not block the export. */
  warnings: MediaWarning[];
}

export interface MenuLoopEncoding {
  mode: VideoExportMode;
  codec: VideoCodec;
  crf: number;
  preset: string;
  color: Pick<VideoColorPlan, "policy" | "source" | "output" | "filterChain">;
}

/** Encoding choices known before the source is probed; the colour plan comes from the reused media plan. */
