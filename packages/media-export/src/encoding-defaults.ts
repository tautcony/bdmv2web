import type { HdrMode, VideoCodec } from "./color/color.js";
import type { VideoExportMode } from "./media-types.js";

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_ENCODE_CODEC: VideoCodec = "hevc";
const DEFAULT_COPY_CODEC: VideoCodec = "h264";
const DEFAULT_CRF_HEVC = 24;
const DEFAULT_CRF_H264 = 18;
const DEFAULT_PRESET = "veryfast";
const DEFAULT_HDR_MODE: HdrMode = "tonemap";
const DEFAULT_VIDEO_MODE: VideoExportMode = "encode";

/** Encoder choices whose fallbacks are shared by the menu-media exporter and the package reuse key. */
export interface EncodingChoice {
  codec?: VideoCodec;
  crf?: number;
  preset?: string;
  hdrMode?: HdrMode;
  videoMode?: VideoExportMode;
  timeoutMs?: number;
}

/** The same choices with every default applied. */
export interface ResolvedEncodingChoice {
  codec: VideoCodec;
  crf: number;
  preset: string;
  hdrMode: HdrMode;
  videoMode: VideoExportMode;
  timeoutMs: number;
}

/** Default the codec, its linked CRF, preset, HDR policy, video mode, and timeout in one place. */
export function resolveEncodingDefaults(choice: EncodingChoice): ResolvedEncodingChoice {
  const videoMode = choice.videoMode ?? DEFAULT_VIDEO_MODE;
  const codec = choice.codec ?? (videoMode === "copy" ? DEFAULT_COPY_CODEC : DEFAULT_ENCODE_CODEC);
  return {
    codec,
    crf: choice.crf ?? (codec === "hevc" ? DEFAULT_CRF_HEVC : DEFAULT_CRF_H264),
    preset: choice.preset ?? DEFAULT_PRESET,
    hdrMode: choice.hdrMode ?? DEFAULT_HDR_MODE,
    videoMode,
    timeoutMs: choice.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}
