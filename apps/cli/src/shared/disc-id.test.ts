import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { normalizeDiscId, readBdmvDiscId } from "./disc-id.js";

describe("BDID metadata", () => {
  it("reads the standard disc_id field from the primary certificate", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdid-primary-"));
    try {
      const bdmv = join(root, "BDMV");
      await mkdir(join(root, "CERTIFICATE"), { recursive: true });
      const bytes = Buffer.alloc(60); bytes.write("BDID", 0, "ascii"); Buffer.from("00112233445566778899aabbccddeeff", "hex").copy(bytes, 44);
      await writeFile(join(root, "CERTIFICATE", "id.bdmv"), bytes);
      expect(await readBdmvDiscId(bdmv)).toBe("00112233445566778899aabbccddeeff");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("reads the backup certificate when the primary is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdid-backup-"));
    try {
      const bdmv = join(root, "BDMV");
      await mkdir(join(root, "CERTIFICATE", "BACKUP"), { recursive: true });
      const bytes = Buffer.alloc(60); bytes.write("BDID", 0, "ascii"); Buffer.from("ffeeddccbbaa99887766554433221100", "hex").copy(bytes, 44);
      await writeFile(join(root, "CERTIFICATE", "BACKUP", "id.bdmv"), bytes);
      expect(await readBdmvDiscId(bdmv)).toBe("ffeeddccbbaa99887766554433221100");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("normalizes explicit IDs and rejects values outside the 32-hex contract", () => {
    expect(normalizeDiscId("00112233445566778899AABBCCDDEEFF")).toBe("00112233445566778899aabbccddeeff");
    expect(() => normalizeDiscId("not-a-disc-id")).toThrow(/32 hexadecimal/);
    expect(() => normalizeDiscId("0011")).toThrow(/32 hexadecimal/);
  });
});
