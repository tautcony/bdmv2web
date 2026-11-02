import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

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
    ["inspect", [], false],
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
});
