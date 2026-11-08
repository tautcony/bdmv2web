/**
 * Cross-package comparison against VideoLAN libbluray 1.5.0.
 *
 * test-data/baselines/libbluray-1.5.0-navigation-baseline.json was produced from
 * bd_info, bd_list_titles -a, the pinned-source mobj_dump disassembly and
 * libbluray's own HDMV VM (see scripts/generate-libbluray-baselines.py). The
 * graph rows are derived from libbluray's per-command semantics, so the whole
 * static control-flow graph has an independent source. Tests read only the
 * golden and the checked-in fixtures; libbluray is not needed at test time.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBdmv } from "@bdmv2web/bdmv-parser";
import { buildNavigationGraph, decodeInstruction } from "@bdmv2web/hdmv";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const goldenPath = resolve(repositoryRoot, "test-data/baselines/libbluray-1.5.0-navigation-baseline.json");
const corpusRoot = resolve(repositoryRoot, "test-data/fixtures/hdmv-navigation/disc-data");
const syntheticRoot = resolve(repositoryRoot, "test-data/fixtures/synthetic-all-features");
const discRoot = (caseId: string) => caseId === "synthetic-all-features" ? syntheticRoot : resolve(corpusRoot, caseId);

type CommandRow = { pc: number; bytes: string; opcode: string | null; disasm: string };
type ObjectRow = { id: number; numCommands: number; resumeIntention: number; menuCallMask: number; titleSearchMask: number; commands: CommandRow[] };
type TitleRow = { index: number; duration: string; chapters: number; angles: number; clips: number; playlist: number; video: number; audio: number; pg: number; ig: number };
type EdgeRow = [string, string | null, string, string];
type Golden = {
  reference: { tool: string; version: string; revision: string; commands: string[] };
  cases: Array<{
    case: string;
    discInfo: { firstPlay: boolean; topMenu: boolean; hdmvTitles: number; bdjTitles: number; unsupportedTitles: number };
    titles: TitleRow[];
    index: { titleIdRefs: number[]; firstPlayIdRef: number | null; topMenuIdRef: number | null };
    vmTrace: { playlists: number[]; titles: number[] };
    objects: ObjectRow[];
    graph: EdgeRow[];
  }>;
};

const corpus = ["tamako", "kyoani-ova", "bang-dream-mygo-vol1", "battle-royale-uhd", "synthetic-all-features"] as const;

describe("libbluray 1.5.0 navigation baseline", () => {
  it.each(corpus)("matches libbluray's index, disassembly, titles and full CFG for %s", async (caseId) => {
    const golden = JSON.parse(await readFile(goldenPath, "utf8")) as Golden;
    const expected = golden.cases.find((entry) => entry.case === caseId);
    expect(expected, `missing libbluray baseline for ${caseId}`).toBeDefined();
    const disc = await parseBdmv(resolve(discRoot(caseId), "BDMV"));

    const expectedEntries = expected!.discInfo.hdmvTitles
      + Number(expected!.discInfo.firstPlay) + Number(expected!.discInfo.topMenu);
    expect(disc.entries, `${caseId} index entries`).toHaveLength(expectedEntries);
    expect(disc.entries.filter((entry) => entry.kind === "title"), `${caseId} HDMV titles`).toHaveLength(expected!.discInfo.hdmvTitles);
    expect(disc.entries.some((entry) => entry.kind === "firstPlay"), `${caseId} first play`).toBe(expected!.discInfo.firstPlay);
    expect(disc.entries.some((entry) => entry.kind === "topMenu"), `${caseId} top menu`).toBe(expected!.discInfo.topMenu);
    expect(disc.entries.filter((entry) => entry.kind === "title").map((entry) => entry.target.target),
      `${caseId} title object refs`).toEqual(expected!.index.titleIdRefs);
    expect(disc.entries.find((entry) => entry.kind === "firstPlay")?.target.target,
      `${caseId} first play object`).toBe(expected!.index.firstPlayIdRef);
    expect(disc.entries.find((entry) => entry.kind === "topMenu")?.target.target,
      `${caseId} top menu object`).toBe(expected!.index.topMenuIdRef);

    expect(disc.movieObjects, `${caseId} movie objects`).toHaveLength(expected!.objects.length);
    for (const object of expected!.objects) {
      const actual = disc.movieObjects.find((candidate) => candidate.id === object.id);
      expect(actual, `${caseId} object ${object.id}`).toBeDefined();
      expect({ id: actual!.id, numCommands: actual!.instructions.length,
        resumeIntention: Number(actual!.resumeIntention), menuCallMask: Number(actual!.menuCallMask),
        titleSearchMask: Number(actual!.titleSearchMask) }, `${caseId} object ${object.id} header`).toEqual({
        id: object.id, numCommands: object.numCommands, resumeIntention: object.resumeIntention,
        menuCallMask: object.menuCallMask, titleSearchMask: object.titleSearchMask,
      });
      for (const command of object.commands) {
        const instruction = actual!.instructions[command.pc];
        expect(instruction?.bytes, `${caseId} object ${object.id} command ${command.pc} bytes`).toBe(command.bytes);
        expect(decodeInstruction(instruction!).opcode,
          `${caseId} object ${object.id} command ${command.pc} opcode`).toBe(command.opcode);
      }
    }

    for (const title of expected!.titles) {
      const playlist = disc.playlists.find((candidate) => Number(candidate.id) === title.playlist);
      expect(playlist, `${caseId} playlist ${title.playlist}`).toBeDefined();
      expect({ clips: playlist!.playItems.length, chapters: playlist!.marks.filter((mark) => mark.type === 1).length },
        `${caseId} playlist ${title.playlist} structure`).toEqual({ clips: title.clips, chapters: title.chapters });
    }

    const graph = buildNavigationGraph(disc.movieObjects, [], { entries: disc.entries, maxStates: 200_000 });
    expect(graph.edges.map((edge) => [edge.from, edge.to, edge.kind, edge.resolution]),
      `${caseId} complete control-flow graph`).toEqual(expected!.graph);

    // libbluray's VM can reach a playlist through a title selection, so a VM
    // playlist is not required to have a static PLAY_PL edge. It must still be
    // one of the playlists libbluray itself declares for this disc.
    for (const playlist of expected!.vmTrace.playlists) {
      expect(expected!.titles.some((title) => title.playlist === playlist),
        `${caseId} libbluray VM playlist ${playlist} is declared by bd_list_titles`).toBe(true);
      expect(disc.playlists.some((candidate) => Number(candidate.id) === playlist),
        `${caseId} libbluray VM playlist ${playlist} is parsed by this project`).toBe(true);
    }
  }, 60_000);
});
