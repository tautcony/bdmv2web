import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "../schema/disc-ir.schema.json" with { type: "json" };
import type { DiscIR as GeneratedDiscIR } from "./disc-ir.generated.js";
import { ContractError } from "./contract-error.js";
import { DEFAULT_LIMITS, type Limits } from "./limits.js";

export type DiscIR = GeneratedDiscIR;
export type Time90k = string;
export type Origin = "primary" | "backup";
export type SourceRef = DiscIR["entries"][number]["source"];
export type NavigationDescriptor = DiscIR["entries"][number]["navigation"];
export type AssetReference = DiscIR["mediaAssets"][number];
export type Diagnostic = DiscIR["diagnostics"][number];
export { DEFAULT_PLAYER_PROFILE } from "./defaults.js";
export { ContractError } from "./contract-error.js";
export { DEFAULT_LIMITS, validateLimits } from "./limits.js";
export type { Limits } from "./limits.js";

export interface ActionEnvelope<T> {
  sessionId: string;
  generation: number;
  actionId: string;
  action: T;
}

export interface EventEnvelope<T> {
  sessionId: string;
  generation: number;
  sequence: number;
  responseTo?: string;
  event: T;
}

export interface PlayerProfile {
  menuLanguage: string;
  audioLanguage: string;
  subtitleLanguage: string;
  country: string;
  region: "A" | "B" | "C";
  outputProfile: "portable";
  videoProfiles: string[];
  audioProfiles: string[];
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateDiscIR = ajv.compile(schema);

export function parseDiscIR(input: unknown): DiscIR {
  if (!validateDiscIR(input)) {
    const issue = validateDiscIR.errors?.[0];
    const path = issue?.instancePath || "/";
    const code = issue?.keyword === "const" && path.endsWith("/schemaVersion") ? "UNKNOWN_SCHEMA_VERSION" : "SCHEMA_VALIDATION_FAILED";
    throw new ContractError(code, path, issue?.message ?? "Invalid DiscIR");
  }
  const ir = input as unknown as DiscIR;
  const ids = new Map<string, string>();
  const add = (id: string, path: string) => {
    if (ids.has(id)) throw new ContractError("DUPLICATE_ID", path, `ID '${id}' duplicates ${ids.get(id)}`);
    ids.set(id, path);
  };
  ir.entries.forEach((e, i) => add(e.id, `/entries/${i}/id`));
  ir.programs.forEach((e, i) => add(e.id, `/programs/${i}/id`));
  ir.menus.forEach((e, i) => add(e.id, `/menus/${i}/id`));
  ir.playlists.forEach((e, i) => add(e.id, `/playlists/${i}/id`));
  ir.mediaAssets.forEach((e, i) => add(e.id, `/mediaAssets/${i}/id`));
  const programs = new Set(ir.programs.map((x) => x.id));
  const menus = new Set(ir.menus.map((x) => x.id));
  ir.playlists.forEach((p, i) => {
    p.programIds.forEach((id, j) => { if (!programs.has(id)) throw new ContractError("DANGLING_REFERENCE", `/playlists/${i}/programIds/${j}`, `Unknown program '${id}'`); });
    p.menuIds.forEach((id, j) => { if (!menus.has(id)) throw new ContractError("DANGLING_REFERENCE", `/playlists/${i}/menuIds/${j}`, `Unknown menu '${id}'`); });
  });
  return ir;
}

const TIME90K = /^(0|[1-9][0-9]*)$/;
export function parseTime90k(value: string): bigint {
  if (!TIME90K.test(value)) throw new ContractError("INVALID_TIME90K", "/time90k", "Expected a non-negative canonical decimal integer");
  return BigInt(value);
}
export function serializeTime90k(value: bigint): Time90k {
  if (value < 0n) throw new ContractError("INVALID_TIME90K", "/time90k", "Time90k cannot be negative");
  return value.toString(10);
}
export function from45k(value: string): Time90k {
  return serializeTime90k(parseTime90k(value) * 2n);
}
export function serializeOffset(value: bigint): string { return serializeTime90k(value); }
export function parseOffset(value: string): bigint { return parseTime90k(value); }

export function assertWithinLimit(value: number | bigint, key: keyof Limits, limits: Limits = DEFAULT_LIMITS): void {
  const cap = limits[key];
  if (cap === null) return;
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) throw new ContractError("INVALID_LENGTH", `/${key}`, "Value must be a non-negative safe integer");
  if (typeof value === "bigint" && value < 0n) throw new ContractError("INVALID_LENGTH", `/${key}`, "Value must be non-negative");
  if (BigInt(value) > BigInt(cap)) throw new ContractError("LIMIT_EXCEEDED", `/${key}`, `Value exceeds configured limit ${cap}`);
}

export function allocateBoundedBytes(size: number, key: "maxReadWindowBytes" | "maxSegmentBytes" | "maxReassemblyBytes" | "maxOutputBytes", limits: Limits = DEFAULT_LIMITS): Uint8Array {
  assertWithinLimit(size, key, limits);
  return new Uint8Array(size);
}

export function checkedObjectPixels(width: number, height: number, limits: Limits = DEFAULT_LIMITS): number {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new ContractError("INVALID_DIMENSIONS", "/dimensions", "Object dimensions must be positive safe integers");
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels)) throw new ContractError("INTEGER_OVERFLOW", "/dimensions", "Object pixel count exceeds safe integer range");
  assertWithinLimit(pixels, "maxObjectPixels", limits);
  return pixels;
}

export { BinaryCursor } from "./binary-cursor.js";
