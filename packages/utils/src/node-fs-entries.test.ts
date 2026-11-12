import type { Dirent } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { directoryBytesExcludingPaths } from "./node-fs.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, readdir: vi.fn(original.readdir) };
});

it("counts regular files while skipping links and special entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "bdmv-utils-entries-"));
  try {
    await writeFile(join(root, "file"), "abc");
    const entry = (name: string, kind: "file" | "link" | "special"): Dirent => ({
      name,
      isSymbolicLink: () => kind === "link",
      isDirectory: () => false,
      isFile: () => kind === "file",
    }) as Dirent;
    vi.mocked(readdir).mockResolvedValueOnce([entry("file", "file"), entry("link", "link"), entry("special", "special")] as never);
    expect(await directoryBytesExcludingPaths(root, new Set())).toBe(3n);
  } finally { await rm(root, { recursive: true, force: true }); }
});
