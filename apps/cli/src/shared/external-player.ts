import { spawn } from "node:child_process";
import { posix, win32 } from "node:path";
import { isDeclaredExternalStreamPath, type ExternalPlayItem, type ExternalPlayTarget } from "@bdmv2web/media-export/external-targets";

type AvailableTarget = Extract<ExternalPlayTarget, { status: "available" }>;
type UnavailableTarget = Extract<ExternalPlayTarget, { status: "unavailable" }>;
export interface WholeFilePlaybackTarget {
  status: "whole-file";
  clipId: string;
  streamPath: string;
  present: boolean;
  source: ExternalPlayItem["source"];
}
type NativePlaybackTarget = AvailableTarget | WholeFilePlaybackTarget;
export type NativePlayerAdapter = "system" | "mpv";
export interface NativePlayerOptions {
  bdmvRoot: string;
  platform?: NodeJS.Platform;
  adapter?: NativePlayerAdapter;
  executable?: string;
}
export interface PlayerCommand { command: string; args: string[] }
export interface NativePlayerLaunch extends PlayerCommand {
  status: "available";
  adapter: NativePlayerAdapter;
  target: NativePlaybackTarget;
}
export type NativePlayerHandoff =
  | { status: "requested"; adapter: NativePlayerAdapter; target: NativePlaybackTarget; playbackState: "unobserved" }
  | UnavailableTarget
  | { status: "error"; code: string; message: string; source: ExternalPlayItem["source"] };

export const NATIVE_PLAYER_CAPABILITIES = {
  system: { singleFile: true, boundedPlayback: false, positioning: false, multipleItems: false, playbackEvents: false },
  mpv: { singleFile: true, boundedPlayback: true, positioning: true, multipleItems: true, playbackEvents: false },
} as const;

function createSystemOpenCommand(path: string, platform: NodeJS.Platform): PlayerCommand | null {
  if (platform === "darwin") return { command: "open", args: ["--", path] };
  if (platform === "win32") return { command: "explorer.exe", args: [path] };
  if (platform === "linux") return { command: "xdg-open", args: [path] };
  return null;
}

export function buildExternalPlayerLaunch(target: ExternalPlayTarget | WholeFilePlaybackTarget, options: NativePlayerOptions): NativePlayerLaunch | UnavailableTarget {
  if (target.status === "unavailable") return target;
  const adapter = options.adapter ?? "system";
  const source = target.status === "whole-file" ? target.source : target.item.source;
  const unavailable = (code: string, message: string, item?: ExternalPlayItem): UnavailableTarget => ({ status: "unavailable", code, message, source: item?.source ?? source });
  const platform = options.platform ?? process.platform;
  const paths = platform === "win32" ? win32 : posix;
  if (target.status === "whole-file") {
    if (!isDeclaredExternalStreamPath(target.clipId, target.streamPath)) return unavailable("EXTERNAL_TARGET_UNDECLARED", `Clip ${target.clipId} has no declared STREAM target.`);
    if (!target.present) return unavailable("EXTERNAL_STREAM_MISSING", `Source ${target.streamPath} is missing.`);
    const filename = paths.resolve(options.bdmvRoot, target.streamPath);
    const command = adapter === "system" ? createSystemOpenCommand(filename, platform) : { command: options.executable ?? "mpv", args: ["--no-terminal", "--", filename] };
    if (!command) return unavailable("EXTERNAL_PLATFORM_UNSUPPORTED", `System file opening is unavailable for ${platform}.`);
    return { status: "available", adapter, target, ...command };
  }
  if (adapter === "system") {
    return unavailable("EXTERNAL_PLAYER_CAPABILITY_UNAVAILABLE", "The system opener accepts whole files. This playlist requires bounded playback; use --player mpv with a compatible mpv executable.");
  }
  const segments: string[] = [];
  for (const [index, item] of [target.item, ...target.remainingItems].entries()) {
    if (!isDeclaredExternalStreamPath(item.clipId, item.streamPath)) return unavailable("EXTERNAL_TARGET_UNDECLARED", `Clip ${item.clipId} has no declared STREAM target.`, item);
    if (!item.present) return unavailable("EXTERNAL_STREAM_MISSING", `Source ${item.streamPath} is missing.`, item);
    if (item.sourceOrigin90k === null) return unavailable("EXTERNAL_TIME_UNRESOLVED", `Clip ${item.clipId} has no resolved source clock origin.`, item);
    const origin = BigInt(item.sourceOrigin90k);
    const start = BigInt(index === 0 ? target.clipTime90k : item.sourceIn90k);
    const end = BigInt(item.sourceOut90k);
    if (start < origin || start < BigInt(item.sourceIn90k) || end <= start) return unavailable("EXTERNAL_TIME_INVALID", `PlayItem ${item.index} has an invalid playback interval.`, item);
    const filename = paths.resolve(options.bdmvRoot, item.streamPath).replaceAll("\\", "/");
    segments.push(`%${Buffer.byteLength(filename, "utf8")}%${filename},${seconds(start - origin)},${seconds(end - start)}`);
  }
  return {
    status: "available", adapter, target, command: options.executable ?? "mpv",
    args: ["--no-terminal", "--", `edl://${segments.join(";")}`],
  };
}

export async function launchExternalPlayer(launch: NativePlayerLaunch | UnavailableTarget): Promise<NativePlayerHandoff> {
  if (launch.status === "unavailable") return launch;
  return new Promise((resolve) => {
    try {
      const child = spawn(launch.command, launch.args, { detached: true, stdio: "ignore", windowsHide: true });
      child.once("error", (error) => resolve({ status: "error", code: "EXTERNAL_PLAYER_LAUNCH_FAILED", message: error.message, source: launchSource(launch) }));
      child.once("spawn", () => {
        child.unref();
        resolve({ status: "requested", adapter: launch.adapter, target: launch.target, playbackState: "unobserved" });
      });
    } catch (error) {
      resolve({ status: "error", code: "EXTERNAL_PLAYER_LAUNCH_FAILED", message: error instanceof Error ? error.message : String(error), source: launchSource(launch) });
    }
  });
}

function launchSource(launch: NativePlayerLaunch): ExternalPlayItem["source"] {
  return launch.target.status === "whole-file" ? launch.target.source : launch.target.item.source;
}

function seconds(ticks: bigint): string {
  const fraction = (ticks % 90_000n * 1_000_000n / 90_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${ticks / 90_000n}${fraction ? `.${fraction}` : ""}`;
}
