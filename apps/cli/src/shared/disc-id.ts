import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Normalize an explicitly supplied 128-bit BDID. */
export function normalizeDiscId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(normalized)) throw new Error("Disc ID must contain exactly 32 hexadecimal characters.");
  return normalized;
}

/** Read the BDID disc_id field from the standard primary or backup id.bdmv file. */
export async function readBdmvDiscId(bdmvRoot: string): Promise<string | undefined> {
  for (const path of [
    resolve(bdmvRoot, "..", "CERTIFICATE", "id.bdmv"),
    resolve(bdmvRoot, "..", "CERTIFICATE", "BACKUP", "id.bdmv"),
  ]) {
    let data: Buffer;
    try { data = await readFile(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (data.length < 60 || data.toString("ascii", 0, 4) !== "BDID") {
      throw new Error(`Invalid BDID metadata in ${path}.`);
    }
    return data.subarray(44, 60).toString("hex");
  }
  return undefined;
}
