import { runCommand } from "../helpers/run-cli.js";
import { syntheticNonStreamBytes, syntheticPgsStream } from "../helpers/synthetic-streams.js";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bdmvFixture = resolve(cliRoot, "../../test-data/fixtures/synthetic-all-features/BDMV");
const igsStreamFixture = resolve(cliRoot, "../../test-data/fixtures/igs-parser/synthetic-single-object.m2ts");

interface ManifestAsset { type: string; path: string; [key: string]: unknown }
interface Manifest { assets: ManifestAsset[] }

async function readManifest(directory: string): Promise<Manifest> {
  return JSON.parse(await readFile(join(directory, "assets-manifest.json"), "utf8")) as Manifest;
}

/** PNG records are what both commands write; containers only exist in export output. */
function pngRecords(manifest: Manifest): ManifestAsset[] {
  return manifest.assets.filter((asset) => asset.type === "igs-png" || asset.type === "sup-png");
}

async function expectIdenticalPngs(exported: string, rendered: string, records: ManifestAsset[]): Promise<void> {
  expect(records.length).toBeGreaterThan(0);
  for (const record of records) {
    const fromExport = await readFile(join(exported, record.path));
    const fromRender = await readFile(join(rendered, record.path));
    expect(fromRender.equals(fromExport), record.path).toBe(true);
  }
}

describe("render matches export --render", async () => {
  it("writes the same PNG records and bytes for a stream file", async () => {
    const parent = await mkdtemp(join(tmpdir(), "render-parity "));
    const stream = join(parent, "clip.rsks");
    const exported = join(parent, "exported");
    const rendered = join(parent, "rendered");
    try {
      await writeFile(stream, syntheticPgsStream({ displaySets: 2, firstPts: 1_000_000n }));
      const exportRun = await runCommand(["export", stream, "--out", exported, "--type", "sup", "--render"]);
      expect(exportRun.status, String(exportRun.stderr)).toBe(0);
      const renderRun = await runCommand(["render", stream, "--out", rendered, "--type", "sup"]);
      expect(renderRun.status, String(renderRun.stderr)).toBe(0);

      const exportManifest = await readManifest(exported);
      const renderManifest = await readManifest(rendered);
      // export writes the .sup container; render writes PNGs only, so the PNG
      // subset has to line up record for record.
      expect(exportManifest.assets.map((asset) => asset.type)).toEqual(["sup", "sup-png", "sup-png"]);
      expect(renderManifest.assets).toEqual(pngRecords(exportManifest));
      expect(existsSync(join(rendered, "assets/subtitles/clip-pid-1200.sup"))).toBe(false);
      await expectIdenticalPngs(exported, rendered, pngRecords(exportManifest));
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("writes the same element PNGs for an IGS stream file", async () => {
    const parent = await mkdtemp(join(tmpdir(), "render-parity "));
    const exported = join(parent, "exported");
    const rendered = join(parent, "rendered");
    try {
      const exportRun = await runCommand(["export", igsStreamFixture, "--out", exported, "--type", "igs", "--render"]);
      expect(exportRun.status, String(exportRun.stderr)).toBe(0);
      const renderRun = await runCommand(["render", igsStreamFixture, "--out", rendered, "--type", "igs"]);
      expect(renderRun.status, String(renderRun.stderr)).toBe(0);

      const exportManifest = await readManifest(exported);
      const renderManifest = await readManifest(rendered);
      expect(exportManifest.assets.map((asset) => asset.type)).toEqual(["igs", "igs-png"]);
      expect(renderManifest.assets).toEqual(pngRecords(exportManifest));
      await expectIdenticalPngs(exported, rendered, pngRecords(exportManifest));
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("writes the same PNG records and bytes for a BDMV disc", async () => {
    const parent = await mkdtemp(join(tmpdir(), "render-parity "));
    const exported = join(parent, "exported");
    const rendered = join(parent, "rendered");
    try {
      const exportRun = await runCommand(["export", bdmvFixture, "--out", exported, "--type", "all", "--render"]);
      expect(exportRun.status, String(exportRun.stderr)).toBe(0);
      const renderRun = await runCommand(["render", bdmvFixture, "--out", rendered, "--type", "all"]);
      expect(renderRun.status, String(renderRun.stderr)).toBe(0);

      const exportManifest = await readManifest(exported);
      const renderManifest = await readManifest(rendered);
      expect(renderManifest.assets).toEqual(pngRecords(exportManifest));
      expect(existsSync(join(rendered, "assets/igs"))).toBe(false);
      await expectIdenticalPngs(exported, rendered, pngRecords(exportManifest));
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("restricts BDMV output to one clip with --m2ts", async () => {
    const parent = await mkdtemp(join(tmpdir(), "render-parity "));
    const all = join(parent, "all");
    const one = join(parent, "one");
    try {
      const first = await runCommand(["render", bdmvFixture, "--out", all, "--type", "sup"]);
      expect(first.status, String(first.stderr)).toBe(0);
      const everything = pngRecords(await readManifest(all));
      const clipId = everything[0]!.path.split("/").pop()!.slice(0, 5);
      const second = await runCommand(["render", bdmvFixture, "--out", one, "--type", "sup", "--m2ts", clipId]);
      expect(second.status, String(second.stderr)).toBe(0);
      const subset = pngRecords(await readManifest(one));
      expect(subset.length).toBeGreaterThan(0);
      expect(subset.length).toBeLessThan(everything.length);
      expect(subset).toEqual(everything.filter((asset) => asset.path.includes(`/${clipId}-pid-`)));
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("reports the same steps and stdout contract as export", async () => {
    const parent = await mkdtemp(join(tmpdir(), "render-parity "));
    const stream = join(parent, "clip.rsks");
    try {
      await writeFile(stream, syntheticPgsStream({ displaySets: 2, firstPts: 1_000_000n }));
      const result = await runCommand(["render", stream, "--out", join(parent, "out"), "--type", "sup", "--progress"]);
      expect(result.status, String(result.stderr)).toBe(0);
      const lines = String(result.stderr).split("\n");
      expect(lines[0]).toContain("bdmv2web render");
      for (const step of ["Probe stream tables", "Extract graphics streams", "Decode display sets", "Write manifest and commit"]) {
        expect(lines).toContainEqual(expect.stringContaining(step));
      }
      expect(lines).toContainEqual(expect.stringMatching(/\s+100% {2}\d+\/2 display sets$/));
      expect(String(result.stderr)).toContain("Done in ");
      expect(JSON.parse(String(result.stdout))).toMatchObject({ stageStatus: "complete", assetCount: 2 });
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("fails the stream contract before writing output", async () => {
    const parent = await mkdtemp(join(tmpdir(), "render-parity "));
    const garbage = join(parent, "garbage.rsks");
    const output = join(parent, "out");
    try {
      await writeFile(garbage, syntheticNonStreamBytes());
      const invalid = await runCommand(["render", garbage, "--out", output, "--type", "sup"]);
      expect(invalid.status).toBe(1);
      expect(String(invalid.stderr)).toContain("EXPORT_INVALID_STREAM");
      expect(existsSync(output)).toBe(false);

      const stream = join(parent, "clip.rsks");
      await writeFile(stream, syntheticPgsStream({ displaySets: 1 }));
      const clipSelection = await runCommand(["render", stream, "--out", output, "--m2ts", "00005"]);
      expect(clipSelection.status).toBe(1);
      expect(String(clipSelection.stderr)).toContain("CLI_RENDER_SELECTION");
      expect(existsSync(output)).toBe(false);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
});
