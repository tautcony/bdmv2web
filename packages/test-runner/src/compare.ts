export interface CompareInputSequence {
  fixtureId: string;
  sourceLabel: string;
  playerProfile: Record<string, unknown>;
  initialRegisters: Record<string, number | string>;
  stableEntry: string;
  seed: number;
  events: Array<{ at90k: string; type: string; [key: string]: unknown }>;
}

export interface TraceEvent extends Record<string, unknown> {
  source?: { path?: string | null; offset?: string | null; instructionIndex?: number | null; entityId?: string | null } | null;
}

export interface TraceDivergence {
  equal: false;
  index: number;
  reference: TraceEvent | null;
  actual: TraceEvent | null;
  differingFields: string[];
  referenceSource: TraceEvent["source"];
  actualSource: TraceEvent["source"];
}

export interface TraceMatch { equal: true; count: number }
export type TraceComparison = TraceMatch | TraceDivergence;

const NON_SEMANTIC_KEYS = new Set(["timestamp", "wallClock", "wallClockMs", "elapsedMs", "durationMs", "sessionId", "actionId", "sequence", "loggedAt"]);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !NON_SEMANTIC_KEYS.has(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
}

function fieldDiff(reference: unknown, actual: unknown, prefix = ""): string[] {
  if (JSON.stringify(canonical(reference)) === JSON.stringify(canonical(actual))) return [];
  if (Array.isArray(reference) && Array.isArray(actual)) {
    const length = Math.max(reference.length, actual.length);
    return Array.from({ length }, (_, index) => index).flatMap((index) =>
      index >= reference.length || index >= actual.length
        ? [`${prefix}/${index}`]
        : fieldDiff(reference[index], actual[index], `${prefix}/${index}`),
    );
  }
  if (typeof reference !== "object" || reference === null || typeof actual !== "object" || actual === null || Array.isArray(reference) || Array.isArray(actual)) return [prefix || "/"];
  const a = reference as Record<string, unknown>;
  const b = actual as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => !NON_SEMANTIC_KEYS.has(key)).sort();
  return keys.flatMap((key) => fieldDiff(a[key], b[key], `${prefix}/${key}`));
}

export function validateCompareInput(input: unknown): input is CompareInputSequence {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  if (typeof value.fixtureId !== "string" || value.fixtureId.length === 0 || typeof value.sourceLabel !== "string" || value.sourceLabel.length === 0) return false;
  if (typeof value.playerProfile !== "object" || value.playerProfile === null || Array.isArray(value.playerProfile)) return false;
  const profile = value.playerProfile as Record<string, unknown>;
  for (const key of ["menuLanguage", "audioLanguage", "subtitleLanguage", "country", "region", "outputProfile"]) if (typeof profile[key] !== "string") return false;
  if (!["A", "B", "C"].includes(profile.region as string) || profile.outputProfile !== "portable") return false;
  if (!Array.isArray(profile.videoProfiles) || !profile.videoProfiles.every((item) => typeof item === "string") || !Array.isArray(profile.audioProfiles) || !profile.audioProfiles.every((item) => typeof item === "string")) return false;
  if (typeof value.initialRegisters !== "object" || value.initialRegisters === null || Array.isArray(value.initialRegisters)) return false;
  if (!Object.values(value.initialRegisters as Record<string, unknown>).every((item) => typeof item === "string" || (typeof item === "number" && Number.isSafeInteger(item)))) return false;
  if (typeof value.stableEntry !== "string" || !Number.isSafeInteger(value.seed) || !Array.isArray(value.events)) return false;
  let last = -1n;
  for (const event of value.events) {
    if (typeof event !== "object" || event === null || Array.isArray(event)) return false;
    const row = event as Record<string, unknown>;
    if (typeof row.at90k !== "string" || !/^(0|[1-9][0-9]*)$/.test(row.at90k) || typeof row.type !== "string") return false;
    const time = BigInt(row.at90k);
    if (time < last) return false;
    last = time;
  }
  return true;
}

export function compareVmTraces(reference: readonly TraceEvent[], actual: readonly TraceEvent[]): TraceComparison {
  const length = Math.max(reference.length, actual.length);
  for (let index = 0; index < length; index += 1) {
    const expected = reference[index] ?? null;
    const observed = actual[index] ?? null;
    const differingFields = fieldDiff(expected, observed);
    if (differingFields.length) return { equal: false, index, reference: expected, actual: observed, differingFields, referenceSource: expected?.source ?? null, actualSource: observed?.source ?? null };
  }
  return { equal: true, count: reference.length };
}

export interface RgbaFrame {
  width: number;
  height: number;
  timestamp90k: string;
  colorSpace: string;
  pixels: Uint8Array;
}

export interface PixelComparison {
  status: "pass" | "fail" | "not-verified";
  equalPixels: number;
  totalPixels: number;
  firstDifference: null | { x: number; y: number; channel: "r" | "g" | "b" | "a"; expected: number; actual: number };
  reason?: string;
}

const CHANNELS = ["r", "g", "b", "a"] as const;

export function compareIgRgbaFrames(reference: RgbaFrame, actual: RgbaFrame): PixelComparison {
  if (reference.width !== actual.width || reference.height !== actual.height || reference.timestamp90k !== actual.timestamp90k || reference.colorSpace !== actual.colorSpace) {
    return { status: "not-verified", equalPixels: 0, totalPixels: Math.max(0, reference.width * reference.height), firstDifference: null, reason: "Frame dimensions, timestamp, or color-space metadata differ." };
  }
  const totalPixels = reference.width * reference.height;
  if (!Number.isSafeInteger(totalPixels) || totalPixels <= 0 || reference.width <= 0 || reference.height <= 0 || reference.pixels.byteLength !== totalPixels * 4 || actual.pixels.byteLength !== totalPixels * 4) {
    return { status: "not-verified", equalPixels: 0, totalPixels: Math.max(0, totalPixels), firstDifference: null, reason: "RGBA byte count does not match frame dimensions." };
  }
  let equalPixels = 0;
  let firstDifference: PixelComparison["firstDifference"] = null;
  for (let pixel = 0; pixel < totalPixels; pixel += 1) {
    let equal = true;
    for (let channel = 0; channel < 4; channel += 1) {
      const offset = pixel * 4 + channel;
      const expected = reference.pixels[offset]!;
      const observed = actual.pixels[offset]!;
      if (expected !== observed) {
        equal = false;
        if (firstDifference === null) firstDifference = { x: pixel % reference.width, y: Math.floor(pixel / reference.width), channel: CHANNELS[channel]!, expected, actual: observed };
      }
    }
    if (equal) equalPixels += 1;
  }
  return { status: firstDifference === null ? "pass" : "fail", equalPixels, totalPixels, firstDifference };
}

export interface VideoQualityNote {
  category: "video-quality";
  status: "not-verified";
  message: string;
}

export function videoQualityNote(message = "Video encoding quality is assessed separately from IG RGBA pixel comparison."): VideoQualityNote {
  return { category: "video-quality", status: "not-verified", message };
}
