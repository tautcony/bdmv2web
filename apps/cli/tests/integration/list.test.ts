import { runCommand } from "../helpers/run-cli.js";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = resolve(cliRoot, "../../test-data/fixtures/synthetic-all-features/BDMV");

function runList(args: string[]) {
  return runCommand(["list", fixture, ...args]);
}

describe("combined inspect/list command", () => {
  it("reports structure, source-file sizes, graphics payloads, and provenance in text", async () => {
    const result = await runList(["--format", "table"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Navigation entries:");
    expect(result.stdout).toContain("Playlists (3)");
    expect(result.stdout).toContain("M2TS 00001 · source STREAM/00001.m2ts · file size 6144 bytes");
    expect(result.stdout).toContain("IGS PID 0x1400 · payload 429 bytes");
    expect(result.stdout).toContain("SUP PID 0x1200 · eng");
    expect(result.stdout).toContain("MPLS 00003 / PlayItem 0");
    expect(result.stdout).toContain("payload 180 bytes");
    expect(result.stdout).toContain("Diagnostics (0):\n  none");
  });

  it("uses the same deterministic text and JSON report for both command names", async () => {
    for (const format of ["table", "json"]) {
      const canonical = await runCommand(["inspect", fixture, "--format", format]);
      const alias = await runList(["--format", format]);
      expect(alias.status, alias.stderr).toBe(0);
      expect(alias.stdout).toBe(canonical.stdout);
      expect(alias.stderr).toBe(canonical.stderr);
    }
  });

  it("keeps filtered JSON and --out identical while retaining structural PlayItems", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv combined report "));
    const target = resolve(parent, "inspection.json");
    try {
      const result = await runList(["--type", "igs", "--m2ts", "00001", "--pid", "5120", "--format", "json", "--out", target]);
      expect(result.status, result.stderr).toBe(0);
      const saved = JSON.parse(await readFile(target, "utf8"));
      expect(JSON.parse(result.stdout)).toEqual(saved);
      expect(saved.disc.playlists).toHaveLength(3);
      expect(saved.graphics.streams).toHaveLength(1);
      expect(saved.graphics.scenes).toHaveLength(1);
      expect(saved.graphics.streams[0]).toMatchObject({ clipId: "00001", pid: 0x1400 });
      expect(saved.graphics.scenes[0]).toMatchObject({ clipId: "00001", pid: 0x1400 });
      expect(saved.reachableSup).toEqual([]);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("preserves missing-source diagnostics alongside available assets", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv list missing source "));
    const copiedDisc = join(parent, "BDMV");
    try {
      await cp(fixture, copiedDisc, { recursive: true });
      await rm(join(copiedDisc, "STREAM", "00001.m2ts"));
      const result = await runCommand(["list", copiedDisc, "--format", "table"]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("M2TS 00001 · source unknown · file size unknown");
      expect(result.stdout).toContain("BDMV_MISSING_STREAM");
      expect(result.stdout).toContain("source PLAYLIST/00001.mpls @");
      expect(result.stdout).toContain("M2TS 00002 · source STREAM/00002.m2ts");
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("serializes scenes, elements, SUP references, and payload measurements", async () => {
    const result = await runList(["--format", "json"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout) as {
      schemaVersion: string;
      disc: { analysisStage: string };
      stageStatus: { structure: string; graphics: string };
      graphics: {
        streams: Array<{ clipId: string; pid: number }>;
        scenes: Array<{ clipId: string; pid: number; objects: Array<{ id: number; width: number; height: number }> }>;
        payloadBytesByClip: Record<string, Record<string, number>>;
      };
      reachableSup: Array<{ clipId: string; pid: number; playlistId: string; playItemIndex: number }>;
    };
    expect(report.schemaVersion).toBe("1.0");
    expect(report.disc.analysisStage).toBe("structural");
    expect(report.stageStatus).toEqual({ structure: "complete", graphics: "complete" });
    expect(report.graphics.streams.map(({ clipId, pid }) => [clipId, pid])).toEqual([["00001", 0x1400], ["00002", 0x1400]]);
    expect(report.graphics.scenes.flatMap((scene) => scene.objects.map((object) => [scene.clipId, scene.pid, object.id, object.width, object.height]))).toEqual([
      ["00001", 0x1400, 5, 1, 1], ["00002", 0x1400, 5, 1, 1],
    ]);
    expect(report.reachableSup).toHaveLength(5);
    expect(report.reachableSup).toContainEqual(expect.objectContaining({ clipId: "00001", pid: 0x1200, playlistId: "00003", playItemIndex: 0 }));
    expect(report.graphics.payloadBytesByClip["00001"]?.[String(0x1400)]).toBe(429);
  });

  it.each([["--render"], ["--png-level", "6"]])("rejects %s on inspect/list", async (...options: string[]) => {
    const result = await runList(options);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`CLI_UNKNOWN_OPTION: unknown option '${options[0]}'`);
  });
});
