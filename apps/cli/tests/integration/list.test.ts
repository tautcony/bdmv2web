import { runCommand } from "../helpers/run-cli.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = resolve(cliRoot, "../../test-data/fixtures/synthetic-all-features/BDMV");

function runList(args: string[]) {
  return runCommand(["list", fixture, ...args]);
}

describe("list command", async () => {
  it("reports M2TS sizes and stream payloads in the table view", async () => {
    const result = await runList([]);
    expect(result.status, String(result.stderr)).toBe(0);
    expect(String(result.stderr)).toBe("");
    expect(String(result.stdout)).toContain("M2TS 00001 · 6.0 KB");
    expect(String(result.stdout)).toContain("IGS PID 0x1400 · payload 429 B");
    expect(String(result.stdout)).toContain("SUP PID 0x1200 · eng · Stream 1 · payload 180 B · Playlist 00003 / PlayItem 0");
  });

  it("reports structural IGS streams, image elements, and SUP tracks", async () => {
    const result = await runList(["--format", "json"]);
    expect(result.status, String(result.stderr)).toBe(0);
    expect(String(result.stderr)).toBe("");

    const report = JSON.parse(String(result.stdout)) as {
      schemaVersion: string;
      summary: { igsScenes: number; igsStreams: number; igsImageElements: number; supTracks: number; m2tsWithSup: number };
      assets: Array<{ type: string; path: string }>;
      igsImageElements: Array<{ clipId: string; pid: number; objectId: number; width: number; height: number }>;
    };
    expect(report.schemaVersion).toBe("1.0");
    expect(report.summary).toMatchObject({ igsScenes: 2, igsStreams: 2, igsImageElements: 2, supTracks: 5, m2tsWithSup: 2 });
    expect(report.assets.map((asset) => [asset.type, asset.path])).toEqual([
      ["igs", "assets/igs/00001-pid-1400.mnu"],
      ["igs", "assets/igs/00002-pid-1400.mnu"],
      ["sup", "assets/subtitles/00001-pid-1200.sup"],
      ["sup", "assets/subtitles/00002-pid-1200.sup"],
      ["sup", "assets/subtitles/00002-pid-1201.sup"],
      ["sup", "assets/subtitles/00002-pid-1200-entry2.sup"],
      ["sup", "assets/subtitles/00002-pid-1201-entry2.sup"],
    ]);
    expect(report.igsImageElements.map((element) => [element.clipId, element.pid, element.objectId, element.width, element.height])).toEqual([
      ["00001", 0x1400, 5, 1, 1],
      ["00002", 0x1400, 5, 1, 1],
    ]);
  });

  it.each([["--decode", "png"], ["--png-level", "6"]])("rejects %s on list", async (option, value) => {
    const result = await runList([option, value]);
    expect(result.status).toBe(1);
    expect(String(result.stderr)).toContain(`CLI_UNKNOWN_OPTION: unknown option '${option}'`);
  });
});
