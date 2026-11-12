import { errorText } from "@bdmv2web/utils";
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
export type NativePlayerAdapter = "system";
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
    const command = options.executable ? { command: options.executable, args: [filename] } : createSystemOpenCommand(filename, platform);
    if (!command) return unavailable("EXTERNAL_PLATFORM_UNSUPPORTED", `System file opening is unavailable for ${platform}.`);
    return { status: "available", adapter, target, ...command };
  }
  return unavailable("EXTERNAL_PLAYER_CAPABILITY_UNAVAILABLE", "The system opener accepts whole files. This playlist requires bounded playback.");
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
      resolve({ status: "error", code: "EXTERNAL_PLAYER_LAUNCH_FAILED", message: errorText(error), source: launchSource(launch) });
    }
  });
}

function launchSource(launch: NativePlayerLaunch): ExternalPlayItem["source"] {
  return launch.target.status === "whole-file" ? launch.target.source : launch.target.item.source;
}
