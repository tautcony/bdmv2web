import { reachablePgsReferences, trackIdentityBySourceIn } from "../shared/pgs.js";
import { flagEnabled, optionValue } from "./context.js";
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

/** Asset families a listing or PNG run can produce. */
export type AssetType = "all" | "igs" | "sup";
/**
 * Output families a graphics run can write. `metadata` is the whole structural
 * set and `hdmv` is its command-table section; both name outputs, while
 * `--pid`/`--m2ts` select input streams. Commander validates the values against
 * each command's set before a command body reads them.
 */
export type OutputType = "all" | "metadata" | "hdmv" | "igs" | "sup";

/**
 * What a graphics run writes: structural metadata, `.mnu`/`.sup` containers, and
 * PNG frames, each per family. `--type` names an output, never the input — `igs`
 * and `sup` select their container and (with `--render`) their PNGs, while
 * `--metadata-only` writes the metadata side and leaves containers and PNGs off.
 */
export interface OutputSelection {
  metadata: { hdmv: boolean; igs: boolean; sup: boolean };
  containers: { igs: boolean; sup: boolean };
  png: { igs: boolean; sup: boolean };
}

const NO_METADATA = { hdmv: false, igs: false, sup: false };
const ALL_METADATA = { hdmv: true, igs: true, sup: true };
const NO_FAMILIES = { igs: false, sup: false };
const ALL_FAMILIES = { igs: true, sup: true };

export function assetTypeOption(): AssetType {
  return (optionValue("--type") ?? "all") as AssetType;
}

/** `undefined` when `--type` was not given, so each command can keep its own default. */
export function outputTypeOption(): OutputType | undefined {
  return optionValue("--type") as OutputType | undefined;
}

/** Containers (and their PNGs) a `--type` names; `metadata` and `hdmv` have none. */
function familiesFor(type: OutputType | undefined) {
  switch (type) {
    case "metadata":
    case "hdmv": return NO_FAMILIES;
    case "igs": return { ...NO_FAMILIES, igs: true };
    case "sup": return { ...NO_FAMILIES, sup: true };
    default: return ALL_FAMILIES;
  }
}

/**
 * Metadata sections a `--type` names. Naming a container family (or no type at
 * all) means the asset side, so metadata only appears when asked for by name or
 * when `--metadata-only` selects the metadata-only shape.
 */
function metadataFor(type: OutputType | undefined, assets: boolean) {
  if (type === "metadata" || type === "all") return ALL_METADATA;
  if (type === "hdmv") return { ...NO_METADATA, hdmv: true };
  if (assets) return NO_METADATA;
  if (type === "igs") return { ...NO_METADATA, igs: true };
  if (type === "sup") return { ...NO_METADATA, sup: true };
  return ALL_METADATA;
}

/**
 * `export` writes the containers by default and the structural set on request.
 * `--metadata-only` writes the whole metadata set on its own; with `--type igs`
 * or `--type sup` it writes that one section.
 */
export function exportOutputs(type: OutputType | undefined, assets = true): OutputSelection {
  const families = assets ? familiesFor(type) : NO_FAMILIES;
  return { metadata: metadataFor(type, assets), containers: families, png: families };
}

/** `render` writes PNGs only; its `--type` filters which families are decoded. */
export function pngOutputs(type: "all" | "igs" | "sup"): OutputSelection {
  const families = { igs: type !== "sup", sup: type !== "igs" };
  return { metadata: NO_METADATA, containers: NO_FAMILIES, png: families };
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

export function assetSelection(): AssetSelection {
  const rawClip = optionValue("--m2ts");
  const clipValue = rawClip?.replace(/\.m2ts$/i, "");
  if (clipValue !== undefined && !/^\d{1,5}$/.test(clipValue)) fail("CLI_INVALID_M2TS", "--m2ts must be a clip ID such as 00001");
  const clipId = clipValue?.padStart(5, "0");
  const pid = pidOption();
  return { ...(clipId ? { clipId } : {}), ...(pid === undefined ? {} : { pid }), renderPng: flagEnabled("--render") };
}

/** Clip/PID restriction plus whether the run also renders PNG frames. */
export interface AssetSelection { clipId?: string; pid?: number; renderPng: boolean }

export function selectedClip(clipId: string, selection: { clipId?: string }): boolean { return selection.clipId === undefined || equalsIgnoreCase(selection.clipId, clipId); }
export function selectedPid(pid: number, selection: { pid?: number }): boolean { return selection.pid === undefined || selection.pid === pid; }

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

/** One rendered IGS element, as both `export` and `render` receive it. */
export interface IgsElementAsset {
  relativePath: string;
  pngBytes: Uint8Array;
  width: number;
  height: number;
  objectId: number;
  objectVersion: number;
  paletteId: number;
  paletteVersion: number;
}

/** Manifest record for an IGS element PNG; one shape for every command that writes them. */
export function igsElementRecord(asset: IgsElementAsset): AssetRecord {
  return {
    type: "igs-png", path: asset.relativePath, byteLength: asset.pngBytes.byteLength,
    width: asset.width, height: asset.height,
    objectId: asset.objectId, objectVersion: asset.objectVersion,
    paletteId: asset.paletteId, paletteVersion: asset.paletteVersion,
  };
}
