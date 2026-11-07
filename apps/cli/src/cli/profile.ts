import { ContractError, DEFAULT_PLAYER_PROFILE } from "@bdmv2web/core";
import { DEFAULT_LIMITS, validateLimits } from "@bdmv2web/core/limits";
import { profileWord } from "@bdmv2web/hdmv";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Limits, PlayerProfile } from "@bdmv2web/core";

export async function loadPlayerProfile(path: string | undefined): Promise<PlayerProfile> {
  if (path === undefined) return { ...DEFAULT_PLAYER_PROFILE, videoProfiles: [], audioProfiles: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolve(path), "utf8"));
  } catch (error) {
    throw new ContractError("CLI_INVALID_PROFILE", "/", `--player-profile could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new ContractError("CLI_INVALID_PROFILE", "/", "--player-profile must contain a JSON object");
  const record = parsed as Record<string, unknown>;
  // Reuse the PSR word rules instead of accepting any non-empty string: these
  // values become PSR16-19, and a semantically invalid value can only fail later
  // as an opaque E_IO when the VM is constructed (D-11).
  const menuLanguage = profileWordField(record, "menuLanguage", 3);
  const audioLanguage = profileWordField(record, "audioLanguage", 3);
  const subtitleLanguage = profileWordField(record, "subtitleLanguage", 3);
  const country = profileWordField(record, "country", 2, true);
  if (typeof record.outputProfile !== "string" || record.outputProfile === "") throw new ContractError("CLI_INVALID_PROFILE", "/outputProfile", "--player-profile requires a non-empty string 'outputProfile'");
  if (!["A", "B", "C"].includes(record.region as string)) throw new ContractError("CLI_INVALID_PROFILE", "/region", "--player-profile requires region A, B, or C");
  if (record.outputProfile !== "portable") throw new ContractError("CLI_INVALID_PROFILE", "/outputProfile", "--player-profile supports only the 'portable' output profile");
  for (const key of ["videoProfiles", "audioProfiles"] as const) {
    const value = record[key];
    if (value !== undefined && (!Array.isArray(value) || !value.every((item) => typeof item === "string"))) throw new ContractError("CLI_INVALID_PROFILE", `/${key}`, `--player-profile requires '${key}' to be a string array`);
  }
  return {
    menuLanguage,
    audioLanguage,
    subtitleLanguage,
    country,
    region: record.region as PlayerProfile["region"],
    outputProfile: "portable",
    videoProfiles: (record.videoProfiles as string[] | undefined) ?? [],
    audioProfiles: (record.audioProfiles as string[] | undefined) ?? [],
  };
}

/** Read and validate VM limits before parsing input or opening an output transaction. */
export async function loadLimits(path: string | undefined): Promise<Limits> {
  if (path === undefined) return { ...DEFAULT_LIMITS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolve(path), "utf8"));
  } catch (error) {
    throw new ContractError("INVALID_LIMITS_FILE", "/", `--limits could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateLimits(parsed);
}

/**
 * Validate one profile word with the same rules the register file applies
 * (exact ASCII letter length), normalising case so `ENG`/`us` behave like
 * `eng`/`US` instead of producing a different PSR word.
 */
export function profileWordField(record: Record<string, unknown>, key: string, width: number, uppercase = false): string {
  const value = record[key];
  if (typeof value !== "string" || value === "") throw new ContractError("CLI_INVALID_PROFILE", `/${key}`, `--player-profile requires a non-empty string '${key}'`);
  const normalized = uppercase ? value.toUpperCase() : value.toLowerCase();
  try {
    profileWord(normalized, width, key);
  } catch {
    throw new ContractError("CLI_INVALID_PROFILE", `/${key}`, `--player-profile requires '${key}' to be ${width} ASCII letters`);
  }
  return normalized;
}
