import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertByteLimit, assertDisjointRoots, beginOutputTransaction, buildInputFileTable, readFileChunks, resolveFileReference, resolveInputFile } from "./index.js";
import { selectBdmvChild } from "./bdmv-candidate.js";

const rootRealpathCounter = vi.hoisted(() => ({ root: undefined as string | undefined, canonicalRoot: undefined as string | undefined, count: 0 }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    realpath: async (...args: Parameters<typeof actual.realpath>) => {
      if (String(args[0]) === rootRealpathCounter.root || String(args[0]) === rootRealpathCounter.canonicalRoot) rootRealpathCounter.count += 1;
      return actual.realpath(...args);
    },
  };
});

const roots: string[] = [];
async function temp(name: string) { const path = await mkdtemp(join(tmpdir(), name)); roots.push(path); return path; }
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("bounded stream I/O and path isolation", () => {
  it("rejects multiple case-variant BDMV directories deterministically", () => {
    expect(() => selectBdmvChild([
      { name: "BDMV", kind: "directory" },
      { name: "bdmv", kind: "directory" },
    ], "/disc")).toThrow("BDMV_ROOT_AMBIGUOUS");
  });

  it("rejects a case-variant BDMV symlink candidate", () => {
    expect(() => selectBdmvChild([
      { name: "bDmV", kind: "symlink" },
    ], "/disc")).toThrow("SYMLINK_REJECTED");
  });

  it("streams files in bounded chunks and rejects an oversized configured window before opening", async () => {
    const root = await temp("bdmv io "); const file = join(root, "中文 name.bin"); await writeFile(file, new Uint8Array(12));
    const chunks: number[] = []; for await (const chunk of readFileChunks(file, { maxReadWindowBytes: 4 } as never, 4)) chunks.push(chunk.length);
    expect(chunks).toEqual([4, 4, 4]);
    await expect(async () => { for await (const _ of readFileChunks(file, { maxReadWindowBytes: 3 } as never, 4)) void _; }).rejects.toThrow(/LIMIT_EXCEEDED/);
    expect(() => assertByteLimit(17, 16)).toThrow(/LIMIT_EXCEEDED/);
  });

  it("accepts Unicode and spaces but rejects dot-dot and symlink escapes", async () => {
    const root = await temp("bdmv input "); const external = await temp("bdmv outside ");
    await writeFile(join(root, "正常 #1.bin"), "ok"); await writeFile(join(external, "secret.bin"), "no");
    await symlink(join(external, "secret.bin"), join(root, "escape.bin"));
    expect(await resolveInputFile(root, "正常 #1.bin")).toBe(join(await realpath(root), "正常 #1.bin"));
    const table = await buildInputFileTable(root, ["正常 #1.bin"]);
    expect(resolveFileReference(table, "正常 #1.bin")).toBe(join(await realpath(root), "正常 #1.bin"));
    expect(() => resolveFileReference(table, "unlisted.bin")).toThrow(/FILE_NOT_REGISTERED/);
    await expect(buildInputFileTable(root, ["../secret.bin"])).rejects.toThrow(/PATH_ESCAPE/);
    await expect(resolveInputFile(root, "../outside/secret.bin")).rejects.toThrow(/PATH_ESCAPE/);
    await expect(resolveInputFile(root, "escape.bin")).rejects.toThrow(/PATH_ESCAPE/);
  });

  it("canonicalizes the file table root once for 1000 files", async () => {
    const root = await temp("bdmv input table root ");
    const paths = Array.from({ length: 1000 }, (_, index) => `file-${index}.bin`);
    await Promise.all(paths.map((path) => writeFile(join(root, path), "x")));
    const canonicalRoot = await realpath(root);
    rootRealpathCounter.root = root;
    rootRealpathCounter.canonicalRoot = canonicalRoot;
    rootRealpathCounter.count = 0;
    try {
      const table = await buildInputFileTable(root, paths);
      expect(table.files.size).toBe(1000);
      expect(rootRealpathCounter.count).toBe(1);
    } finally {
      rootRealpathCounter.root = undefined;
      rootRealpathCounter.canonicalRoot = undefined;
    }
  });

  it("rejects output nested inside or containing input", async () => {
    const root = await temp("bdmv overlap "); const nested = join(root, "new-output"); await mkdir(nested);
    await expect(assertDisjointRoots(root, nested)).rejects.toThrow(/PATH_OVERLAP/);
    await expect(assertDisjointRoots(nested, root)).rejects.toThrow(/PATH_OVERLAP/);
    await expect(assertDisjointRoots(root, join(nested, "new-output"), nested)).rejects.toThrow(/PATH_OVERLAP/);
  });
});

describe("output transactions", () => {
  it("aborts without touching source, refuses existing destinations, and commits atomically", async () => {
    const parent = await temp("bdmv tx "); const input = join(parent, "disc"); await mkdir(input); await writeFile(join(input, "source"), "original");
    const before = await readFile(join(input, "source"), "utf8");
    const tx = await beginOutputTransaction(join(parent, "package")); await writeFile(join(tx.stagingPath, "partial"), "temp"); await tx.abort();
    expect(await readFile(join(input, "source"), "utf8")).toBe(before);
    const good = await beginOutputTransaction(join(parent, "package")); await writeFile(join(good.stagingPath, "index.html"), "ready"); await good.commit();
    expect(await readFile(join(parent, "package", "index.html"), "utf8")).toBe("ready");
    await expect(beginOutputTransaction(join(parent, "package"))).rejects.toThrow(/TARGET_EXISTS/);
    expect(await readFile(join(input, "source"), "utf8")).toBe(before);
    const raced = await beginOutputTransaction(join(parent, "appeared-after-begin"));
    await mkdir(join(parent, "appeared-after-begin")); await writeFile(join(parent, "appeared-after-begin", "keep"), "old");
    await expect(raced.commit()).rejects.toThrow(/TARGET_EXISTS/);
    expect(await readFile(join(parent, "appeared-after-begin", "keep"), "utf8")).toBe("old");
    const failed = await beginOutputTransaction(join(parent, "failed-package")); await writeFile(join(failed.stagingPath, "invalid"), "bad");
    await failed.abort(); expect(await readFile(join(input, "source"), "utf8")).toBe(before);
  });

  it("restores the existing package when committing the replacement fails", async () => {
    const parent = await temp("bdmv tx restore ");
    const target = join(parent, "package");
    await mkdir(target);
    await writeFile(join(target, "index.html"), "previous package");
    const tx = await beginOutputTransaction(target, { overwrite: true });
    await writeFile(join(tx.stagingPath, "index.html"), "replacement package");

    await rm(tx.stagingPath, { recursive: true });
    await expect(tx.commit()).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(target, "index.html"), "utf8")).toBe("previous package");
  });
});
