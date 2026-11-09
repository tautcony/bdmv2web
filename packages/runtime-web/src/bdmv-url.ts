import type { ExternalPlayTarget } from "@bdmv2web/media-export/external-targets";

/** Resolve one declared STREAM path against the BDMV path in the current package configuration. */
export function fileUrlFromBdmvPath(bdmvPath: string, streamPath: string, pageUrl: string): string {
  const normalize = (path: string) => path.replace(/\\/g, "/").split("/").map((part, index) => index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)).join("/");
  const base = bdmvPath.replace(/\\/g, "/");
  let bdmvUrl: URL;
  if (/^[A-Za-z]:\//.test(base)) bdmvUrl = new URL(`file:///${normalize(base)}/`);
  else if (base.startsWith("/")) bdmvUrl = new URL(`file://${normalize(base)}/`);
  else bdmvUrl = new URL(`${normalize(base.replace(/\/$/, ""))}/`, pageUrl);
  return new URL(normalize(streamPath), bdmvUrl).href;
}

export type ExternalPlaybackHandoffResult =
  | { status: "requested"; url: string; target: Extract<ExternalPlayTarget, { status: "available" }> }
  | { status: "unavailable" | "unknown"; code: string; message: string; source?: Extract<ExternalPlayTarget, { status: "unavailable" }>['source'] };

export function createExternalPlayerUrl(input: {
  platform: string;
  pageUrl: string;
  bdmvPath: string;
  streamPath: string;
  seekTime90k: string | null;
}): string {
  const videoUrl = fileUrlFromBdmvPath(input.bdmvPath, input.streamPath, input.pageUrl);
  if (/Macintosh|Mac OS X/i.test(input.platform)) {
    if (input.seekTime90k === null) throw new Error("The selected chapter position is unavailable.");
    return `iina://open?url=${encodeURIComponent(videoUrl)}&mpv_start=${format90kSeconds(input.seekTime90k)}`;
  }
  if (/Windows/i.test(input.platform)) return `potplayer://${videoUrl}`;
  throw new Error("External playback is available on macOS and Windows.");
}

/** Initiate one browser protocol navigation and classify only the request outcome. */
export function requestExternalPlayback(input: {
  target: ExternalPlayTarget;
  bdmvPath: string | undefined;
  platform: string;
  pageUrl: string;
  navigate: (url: string) => void;
}): ExternalPlaybackHandoffResult {
  if (input.target.status === "unavailable") {
    const unknownCodes = new Set(["EXTERNAL_PLAYLIST_UNKNOWN", "EXTERNAL_MARK_UNKNOWN", "EXTERNAL_PLAYITEM_UNKNOWN"]);
    return {
      status: unknownCodes.has(input.target.code) ? "unknown" : "unavailable",
      code: input.target.code, message: input.target.message,
      ...(input.target.source ? { source: input.target.source } : {}),
    };
  }
  if (!input.bdmvPath) return { status: "unavailable", code: "EXTERNAL_BDMV_CONFIG_MISSING", message: "The package is missing runtime/bdmv-config.js; set the BDMV path and reload." };
  try {
    const url = createExternalPlayerUrl({ platform: input.platform, pageUrl: input.pageUrl, bdmvPath: input.bdmvPath, streamPath: input.target.item.streamPath, seekTime90k: input.target.seekTime90k });
    input.navigate(url);
    return { status: "requested", url, target: input.target };
  } catch (error) {
    return { status: "unavailable", code: "EXTERNAL_PROTOCOL_UNAVAILABLE", message: error instanceof Error ? error.message : String(error) };
  }
}

export function format90kSeconds(ticks: string): string {
  const value = BigInt(ticks);
  if (value < 0n) throw new RangeError("Playback offset cannot be negative.");
  const whole = value / 90_000n;
  const fraction = ((value % 90_000n) * 1_000_000n / 90_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
