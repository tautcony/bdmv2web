import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { buildM1Index, buildM1MovieObject } from "@bdmv-web/test-fixtures";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("CLI scaffold", () => {
  it("reports an unimplemented command to stderr with a nonzero exit", () => {
    const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "convert"]);
    expect(result.status).toBe(1);
    expect(result.stderr.toString()).toContain("E_NOT_IMPLEMENTED");
    expect(result.stdout.toString()).toBe("");
  });
  it.each([
    ["convert", [], true],
    ["convert", ["--mode", "menu-only"], false],
    ["convert", ["--mode=menu-only", "--strict"], true],
    ["convert", ["--no-strict"], false],
  ])("uses the documented strict default for %s", (command, options, strict) => {
    const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), command, ...options, "--format", "json"]);
    expect(result.status).toBe(1); expect(result.stdout.toString()).toBe("");
    expect(JSON.parse(result.stderr.toString()).strict).toBe(strict);
  });
  it("does not create a requested output for an unimplemented command", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bdmv cli ")); const target = join(dir, "package");
    try {
      const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "convert", "--out", target]);
      expect(result.status).toBe(1); await expect(access(target)).rejects.toThrow();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("reports a missing inspect input as a usage error", () => {
    const result = spawnSync(process.execPath, [resolve(root, "dist/index.js"), "inspect", "--format", "json"]);
    expect(result.status).toBe(1); expect(JSON.parse(result.stderr.toString()).code).toBe("CLI_MISSING_INPUT"); expect(result.stdout.toString()).toBe("");
  });
});

describe("M1 structural CLI", () => {
  async function makeDisc(parent: string, index = buildM1Index()): Promise<string> {
    const root = join(parent, "BDMV"); await mkdir(join(root, "PLAYLIST"), { recursive: true }); await mkdir(join(root, "CLIPINF"), { recursive: true }); await mkdir(join(root, "STREAM"), { recursive: true });
    await writeFile(join(root, "index.bdmv"), index); await writeFile(join(root, "MovieObject.bdmv"), buildM1MovieObject()); return root;
  }
  it("writes independently parseable structural JSON to stdout with no progress text", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv inspect ")); const root = await makeDisc(parent, buildM1Index({ hdmvTitle: 3, bdjTitle: "00042", titleAccess: 2 }));
    try { const result = spawnSync(process.execPath, [resolve(dirname(fileURLToPath(import.meta.url)), "../dist/index.js"), "inspect", root, "--format", "json"]); expect(result.status).toBe(0); expect(result.stderr.toString()).toBe(""); const parsed = JSON.parse(result.stdout.toString()); expect(parsed.analysisStage).toBe("structural"); expect(parsed.supportPrediction.status).toBe("partial"); expect(parsed.declarations.entries).toBe(4); expect(parsed.entries.map((entry: any) => entry.target.objectType)).toEqual(["HDMV", "HDMV", "HDMV", "BDJ"]); expect(parsed.entries[2].target.target).toBe(3); expect(parsed.entries[3].target).toMatchObject({ objectType: "BDJ", target: "00042", accessType: 2 }); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });
  it("extracts only structural artifacts through the output transaction and preserves source bytes", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv extract ")); const root = await makeDisc(parent); const target = join(parent, "out");
    try { const beforeIndex = await readFile(join(root, "index.bdmv")); const beforeMobj = await readFile(join(root, "MovieObject.bdmv")); const result = spawnSync(process.execPath, [resolve(dirname(fileURLToPath(import.meta.url)), "../dist/index.js"), "extract", root, "--out", target]); expect(result.status).toBe(0); expect(JSON.parse(result.stdout.toString()).status).toBe("partial"); const disc = JSON.parse(await readFile(join(target, "parsed-disc.json"), "utf8")); expect(disc.analysisStage).toBe("structural"); expect(disc).not.toHaveProperty("sourceFingerprint"); const commands = JSON.parse(await readFile(join(target, "raw-commands.json"), "utf8")); expect(commands).toHaveLength(2); expect(commands[0].source).toMatchObject({ path: "BDMV/MovieObject.bdmv", offset: "54" }); const manifest = JSON.parse(await readFile(join(target, "manifest.json"), "utf8")); expect(manifest.status).toBe("partial"); expect(manifest).not.toHaveProperty("sourceFingerprint"); expect(manifest.files[1]).toMatchObject({ path: "raw-commands.json", kind: "raw-command-table" }); expect(manifest.files[1].sha256).toMatch(/^[a-f0-9]{64}$/); expect(await readFile(join(root, "index.bdmv"))).toEqual(beforeIndex); expect(await readFile(join(root, "MovieObject.bdmv"))).toEqual(beforeMobj); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });
  it("does not overwrite an existing inspect output target", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv inspect existing ")); const root = await makeDisc(parent); const target = join(parent, "inspection.json"); await writeFile(target, "keep me\n");
    try { const result = spawnSync(process.execPath, [resolve(dirname(fileURLToPath(import.meta.url)), "../dist/index.js"), "inspect", root, "--format", "json", "--out", target]); expect(result.status).toBe(1); expect(await readFile(target, "utf8")).toBe("keep me\n"); }
    finally { await rm(parent, { recursive: true, force: true }); }
  });
});
