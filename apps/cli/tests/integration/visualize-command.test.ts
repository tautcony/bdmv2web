import { describe, expect, it } from "vitest";
import { runCommand } from "../helpers/run-cli.js";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { buildM1ClipInfoWithIgsCue, buildM1Index, buildM1MovieObject, buildM1PlaylistWithAudioPid, m3Fixtures } from "@bdmv2web/test-fixtures";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function hexCommand(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
}

/** [0] PLAY_PL 1, [1] MOVE, [2] JUMP_TITLE 1 → two basic blocks. */
const MOVIE_OBJECT_HEX = [m3Fixtures.playPlaylist1.bytes, m3Fixtures.move5.bytes, m3Fixtures.jumpTitle1.bytes];

async function makeDisc(parent: string): Promise<string> {
  const disc = join(parent, "BDMV");
  await mkdir(join(disc, "PLAYLIST"), { recursive: true });
  await mkdir(join(disc, "CLIPINF"), { recursive: true });
  await mkdir(join(disc, "STREAM"), { recursive: true });
  await writeFile(join(disc, "index.bdmv"), buildM1Index({ first: 0 }));
  await writeFile(join(disc, "MovieObject.bdmv"), buildM1MovieObject(MOVIE_OBJECT_HEX.map(hexCommand)));
  await writeFile(join(disc, "PLAYLIST", "00001.mpls"), buildM1PlaylistWithAudioPid());
  await writeFile(join(disc, "CLIPINF", "00001.clpi"), buildM1ClipInfoWithIgsCue());
  await writeFile(join(disc, "STREAM", "00001.m2ts"), Buffer.alloc(192 * 4, 0));
  return disc;
}

describe("visualize command", () => {
  it("exports the viewer, overview, graph data and per-program diagrams", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv visualize "));
    const disc = await makeDisc(parent);
    const out = join(parent, "graph");
    try {
      const result = await runCommand(["visualize", disc, "--out", out, "--format", "json"]);
      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout) as { counts: Record<string, number>; files: string[]; closure: { complete: boolean; unknown: number } | null };
      expect(summary.counts).toMatchObject({ movieObjects: 1, commands: 3, blocks: 2, playlists: 1 });
      expect(summary.files).toContain("index.html");
      expect(summary.files).toContain("graph.json");
      expect(summary.files).toContain("overview.md");
      expect(summary.files).toContain("programs/mobj-0.md");
      expect(summary.closure).not.toBeNull();

      const viewer = await readFile(join(out, "index.html"), "utf8");
      expect(viewer).toContain('id="payload"');
      expect(viewer).not.toMatch(/<script[^>]+src=/);
      const payload = JSON.parse(viewer.match(/<script type="application\/json" id="payload">([\s\S]*?)<\/script>/)![1]!) as { programs: Array<{ label: string; blocks: unknown[] }> };
      expect(payload.programs[0]).toMatchObject({ label: "MOBJ 0" });
      expect(payload.programs[0]!.blocks).toHaveLength(2);

      const graphJson = JSON.parse(await readFile(join(out, "graph.json"), "utf8")) as { counts: { commands: number } };
      expect(graphJson.counts.commands).toBe(3);

      const overview = await readFile(join(out, "overview.md"), "utf8");
      expect(overview).toContain("```mermaid");
      expect(overview).toContain("MOBJ 0");
      expect(overview).toContain("PL 00001");

      const programDiagram = await readFile(join(out, "programs", "mobj-0.md"), "utf8");
      expect(programDiagram).toContain("flowchart TB");
      expect(programDiagram).toContain('(["00001<br/>playlist"])');
      expect(programDiagram).toContain("|play|");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("refuses to replace an existing directory without --overwrite", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv visualize overwrite "));
    const disc = await makeDisc(parent);
    const out = join(parent, "graph");
    try {
      const first = await runCommand(["visualize", disc, "--out", out, "--format", "json"]);
      expect(first.status, first.stderr).toBe(0);
      const second = await runCommand(["visualize", disc, "--out", out, "--format", "json"]);
      expect(second.status).not.toBe(0);
      expect(second.stderr).toContain("TARGET_EXISTS");
      const third = await runCommand(["visualize", disc, "--out", out, "--overwrite", "--format", "json"]);
      expect(third.status).toBe(0);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("skips the media closure and program diagrams when asked", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv visualize noclosure "));
    const disc = await makeDisc(parent);
    const out = join(parent, "graph");
    try {
      const result = await runCommand(["visualize", disc, "--out", out, "--no-closure", "--programs", "99", "--format", "json"]);
      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout) as { closure: unknown; files: string[] };
      expect(summary.closure).toBeNull();
      expect(summary.files).toEqual(["index.html", "graph.json", "overview.md"]);
      expect((await readdir(join(out, "programs"))).length).toBe(0);
      const payload = JSON.parse(await readFile(join(out, "graph.json"), "utf8")) as { mediaClosure: unknown };
      expect(payload.mediaClosure).toBeNull();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
