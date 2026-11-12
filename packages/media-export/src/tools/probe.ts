import { errorText } from "@bdmv2web/utils";
import type { ColorProbeFields } from "../color/color.js";

export interface ProbeStream extends ColorProbeFields { index?: number; id?: string; codec_type?: string; codec_name?: string; width?: number; height?: number; display_aspect_ratio?: string; sample_rate?: string; channels?: number; duration?: string; }
export interface ProbeResult { streams?: ProbeStream[]; format?: { start_time?: string; duration?: string }; }

export function probeArgs(path: string, options: { deep?: boolean; audio?: boolean } = {}): string[] {
  const depth = options.deep ? ["-probesize", "100M", "-analyzeduration", "100M"] : [];
  const audio = options.audio ? ",sample_rate,channels" : "";
  return ["-v", "error", ...depth, "-show_entries", `stream=index,id,codec_type,codec_name,width,height,display_aspect_ratio${audio},duration,pix_fmt,color_range,color_space,color_transfer,color_primaries,bits_per_raw_sample:stream_side_data=side_data_type:format=start_time,duration`, "-of", "json", path];
}

export function parseProbe(text: string, subject: string, label: string): ProbeResult {
  try {
    const value = JSON.parse(text) as ProbeResult;
    if (!Array.isArray(value.streams)) throw new Error("no streams array");
    return value;
  } catch (error) { throw new Error(`${label} '${subject}': ${errorText(error)}`, { cause: error }); }
}
