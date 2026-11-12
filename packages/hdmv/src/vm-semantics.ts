import { DEFAULT_PLAYER_PROFILE } from "@bdmv2web/core/defaults";
import type { PlayerProfile } from "./registers.js";
import type { DecodedInstruction } from "./decode.js";
import type { MediaEventType, TraceEntry, VmEvent, WaitFor, ActionType } from "./vm-types.js";
import type { RegisterFile } from "./registers.js";
import type { PlayerProfile as CorePlayerProfile } from "@bdmv2web/core";

export const EMPTY_DELTA: TraceEntry["registerDelta"] = { gpr: {}, psr: {} };
export const WAIT_BY_ACTION: Partial<Record<ActionType, WaitFor>> = { PLAY_PLAYLIST: "ended", PLAY_PLAYLIST_ITEM: "ended", PLAY_PLAYLIST_MARK: "ended" };
export const COMPARE_OPCODES = new Set(["BC", "EQ", "NE", "GE", "GT", "LE", "LT"]);
const PSR_TIME_TICKS_PER_SECOND = 45_000;
export const RANDOM_MULTIPLIER = 6_364_136_223_846_793_005n;
export const RANDOM_MASK = 0xffff_ffff_ffff_ffffn;

export function textInstruction(d: DecodedInstruction): string { return `${d.opcode ?? "UNKNOWN"} ${d.operands.filter((x) => x !== null).map((x) => x.kind === "immediate" ? `#${x.value}` : `${x.kind}[${x.value}]`).join(",")}`.trim(); }

export function playbackTicks(event: VmEvent): number | null {
  const presentationTime = event.payload?.presentationTime;
  if (typeof presentationTime === "number" && Number.isFinite(presentationTime) && presentationTime >= 0) return Math.min(0xffffffff, Math.floor(presentationTime));
  const seconds = event.payload?.mediaTimeSeconds;
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) return Math.min(0xffffffff, Math.round(seconds * PSR_TIME_TICKS_PER_SECOND));
  return null;
}
export function delta(before: ReturnType<RegisterFile["snapshot"]>, after: ReturnType<RegisterFile["snapshot"]>): TraceEntry["registerDelta"] {
  const gpr: Record<number, number> = {}, psr: Record<number, number> = {};
  before.gpr.forEach((v, i) => { if (v !== after.gpr[i]) gpr[i] = after.gpr[i]!; }); before.psr.forEach((v, i) => { if (v !== after.psr[i]) psr[i] = after.psr[i]!; }); return { gpr, psr };
}
export function eventMatches(wait: WaitFor | undefined, event: MediaEventType): boolean { return wait === "started" ? event === "MEDIA_STARTED" : wait === "seeked" ? event === "MEDIA_SEEKED" : wait === "ended" ? event === "MEDIA_ENDED" : wait === "still-completed" ? event === "STILL_COMPLETED" : false; }
export function comparisonSkips(opcode: string, a: number, b: number): boolean {
  switch (opcode) {
    case "BC": return (a & ~b) !== 0;
    case "EQ": return a !== b;
    case "NE": return a === b;
    case "GE": return a < b;
    case "GT": return a <= b;
    case "LE": return a > b;
    case "LT": return a >= b;
    default: return false;
  }
}
export function stableProfile(profile: PlayerProfile): string {
  const normalized: Record<string, unknown> = Object.fromEntries(Object.entries(profile).filter(([key]) => key !== "capabilityValues").sort(([a], [b]) => a.localeCompare(b)));
  if (profile.capabilityValues) normalized.capabilityValues = Object.fromEntries(Object.entries(profile.capabilityValues).sort(([a], [b]) => Number(a) - Number(b)));
  return JSON.stringify(normalized);
}

export function normalizeProfile(profile: PlayerProfile | undefined): PlayerProfile {
  const defaults: CorePlayerProfile = DEFAULT_PLAYER_PROFILE;
  return {
    ...defaults,
    ...profile,
    videoProfiles: [...(profile?.videoProfiles ?? defaults.videoProfiles)],
    audioProfiles: [...(profile?.audioProfiles ?? defaults.audioProfiles)],
    ...(profile?.capabilityValues ? { capabilityValues: { ...profile.capabilityValues } } : {}),
  };
}

export function normalizeRandomSeed(value: number | undefined): number {
  const seed = value ?? 1;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new TypeError("randomSeed must be an unsigned 32-bit integer");
  return seed;
}
