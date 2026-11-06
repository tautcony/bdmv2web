import { ContractError } from "./contract-error.js";

export interface Limits {
  maxReadWindowBytes: number;
  maxSegmentBytes: number;
  maxReassemblyBytes: number;
  maxObjectPixels: number;
  maxInstructionsPerTurn: number;
  maxQueueDepth: number;
  maxCallDepth: number;
  maxExplorationStates: number;
  maxOutputBytes: number | null;
}

export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
  maxReadWindowBytes: 8 * 1024 * 1024,
  maxSegmentBytes: 16 * 1024 * 1024,
  maxReassemblyBytes: 64 * 1024 * 1024,
  maxObjectPixels: 16_777_216,
  maxInstructionsPerTurn: 10_000,
  maxQueueDepth: 1024,
  maxCallDepth: 128,
  maxExplorationStates: 100_000,
  maxOutputBytes: null,
});

export function validateLimits(value: unknown): Limits {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ContractError("INVALID_LIMITS", "/", "Limits must be an object");
  const allowedKeys = new Set<keyof Limits>(Object.keys(DEFAULT_LIMITS) as Array<keyof Limits>);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key as keyof Limits)) throw new ContractError("INVALID_LIMIT", `/${key}`, "Unknown limit");
  }
  const merged = { ...DEFAULT_LIMITS, ...value } as Record<string, unknown>;
  for (const [key, v] of Object.entries(merged)) {
    if (key === "maxOutputBytes" && v === null) continue;
    const zeroAllowed = (key === "maxCallDepth" || key === "maxQueueDepth") && v === 0;
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v === 0 && !zeroAllowed) throw new ContractError("INVALID_LIMIT", `/${key}`, "Limit must be a non-negative safe integer for maxCallDepth/maxQueueDepth and a positive safe integer otherwise");
  }
  return merged as unknown as Limits;
}
