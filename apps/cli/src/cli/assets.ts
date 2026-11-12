import { reachablePgsReferences, trackIdentityBySourceIn } from "../shared/pgs.js";
import { optionValue } from "./context.js";
import { fail } from "./errors.js";
import { basename, extname } from "node:path";
import { equalsIgnoreCase } from "@bdmv2web/utils";

export interface AssetRecord {
  type: string;
  format?: string;
  path: string;
  byteLength: number;
  language?: string;
  streamNumber?: number;
  displaySetCount?: number;
  displaySet?: number;
  startSeconds?: number | null;
  endSeconds?: number | null;
  width?: number;
  height?: number;
  sceneId?: string;
  compositionNumber?: number;
  objectId?: number;
  objectVersion?: number;
  paletteId?: number;
  paletteVersion?: number;
}

export type AssetType = "all" | "igs" | "sup";
export function assetTypeOption(): AssetType {
  return validateAssetType(optionValue("--type") ?? "all");
}

/**
 * Deflate level for every PNG the command writes. Omitted keeps each encoder on its
 * tuned default, which differs for sprite sheets and for full-HD subtitle canvases.
 */
export function pngLevelOption(): number | undefined {
  const raw = optionValue("--png-level");
  if (raw === undefined) return undefined;
  if (!/^[0-9]$/.test(raw)) fail("CLI_INVALID_PNG_LEVEL", "--png-level must be a deflate level from 0 to 9");
  return Number(raw);
}

export function pidOption(): number | undefined {
  const rawPid = optionValue("--pid");
  if (rawPid === undefined) return undefined;
  if (!/^(?:0x[\da-f]{1,4}|\d{1,4})$/i.test(rawPid)) fail("CLI_INVALID_PID", "--pid must be a decimal PID or hexadecimal value such as 0x0120");
  const pid = Number(rawPid.toLowerCase().startsWith("0x") ? rawPid : Number(rawPid));
  if (!Number.isInteger(pid) || pid < 0x20 || pid > 0x1ffe) fail("CLI_INVALID_PID", "--pid must be between 0x0020 and 0x1ffe");
  return pid;
}

export function assetSelection(): { clipId?: string; pid?: number; decodePng: boolean } {
  const rawClip = optionValue("--m2ts");
  const clipValue = rawClip?.replace(/\.m2ts$/i, "");
  if (clipValue !== undefined && !/^\d{1,5}$/.test(clipValue)) fail("CLI_INVALID_M2TS", "--m2ts must be a clip ID such as 00001");
  const clipId = clipValue?.padStart(5, "0");
  const pid = pidOption();
  const decode = optionValue("--decode");
  if (decode !== undefined && decode !== "png") fail("CLI_INVALID_DECODE", "--decode supports only 'png'");
  return { ...(clipId ? { clipId } : {}), ...(pid === undefined ? {} : { pid }), decodePng: decode === "png" };
}

export function selectedClip(clipId: string, selection: { clipId?: string }): boolean { return selection.clipId === undefined || equalsIgnoreCase(selection.clipId, clipId); }
export function selectedPid(pid: number, selection: { pid?: number }): boolean { return selection.pid === undefined || selection.pid === pid; }

export function validateAssetType(value: string): AssetType {
  if (value !== "all" && value !== "igs" && value !== "sup") fail("CLI_INVALID_ASSET_TYPE", "--type must be one of all, igs, or sup");
  return value;
}

export function safeAssetStem(path: string): string {
  const stem = basename(path, extname(path)).replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
  return stem || "input";
}

export function uniquePgsReferences(references: ReturnType<typeof reachablePgsReferences>): ReturnType<typeof reachablePgsReferences> {
  return [...new Map(references.map((reference) => [trackIdentityBySourceIn(reference), reference])).values()];
}

/** Distinct output paths for sup tracks that share one stream across PlayItem entry points. */
export function pgsTrackEntrySuffixes(references: ReturnType<typeof reachablePgsReferences>): string[] {
  const seen = new Map<string, number>();
  return references.map((reference) => {
    const base = `${reference.clipId.toLocaleLowerCase("en-US")}:${reference.pid}`;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return occurrence === 0 ? "" : `-entry${occurrence + 1}`;
  });
}

export function safeAssetLanguage(language: string): string { return /^[a-z]{3}$/i.test(language) ? language.toLowerCase() : "und"; }
export function igsMnuPath(clipId: string, pid: number): string { return `assets/igs/${clipId}-pid-${pid.toString(16).padStart(4, "0")}.mnu`; }
export function supTrackPath(clipId: string, pid: number, _index: number, entrySuffix = ""): string { return `assets/subtitles/${clipId}-pid-${pid.toString(16).padStart(4, "0")}${entrySuffix}.sup`; }
export function supDisplaySetPath(clipId: string, pid: number, language: string, index: number, entrySuffix = ""): string {
  return `assets/subtitles/${clipId}-pid-${pid.toString(16).padStart(4, "0")}${entrySuffix}-${safeAssetLanguage(language)}-display-${String(index + 1).padStart(5, "0")}.png`;
}
