import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { directoryBytesExcluding, directoryBytesExcludingPaths, fileBytes } from "./node-fs.js";

describe("filesystem byte counts", () => {
  it("counts files and excludes selected paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "bdmv-utils-"));
    try {
      const nested = join(root, "nested");
      const first = join(root, "first");
      const second = join(nested, "second");
      await mkdir(nested);
      await writeFile(first, "abc");
      await writeFile(second, "12345");
      expect(await fileBytes(first)).toBe(3n);
      expect(await fileBytes(join(root, "missing"))).toBe(0n);
      expect(await directoryBytesExcluding(root, first)).toBe(5n);
      expect(await directoryBytesExcludingPaths(root, new Set([nested]))).toBe(3n);
      expect(await directoryBytesExcludingPaths(join(root, "missing"), new Set())).toBe(0n);
      await expect(fileBytes(join(first, "child"))).rejects.toMatchObject({ code: "ENOTDIR" });
      await expect(directoryBytesExcludingPaths(first, new Set())).rejects.toMatchObject({ code: "ENOTDIR" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
