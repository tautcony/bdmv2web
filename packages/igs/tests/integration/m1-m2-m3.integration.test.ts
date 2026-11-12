import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildM1ClipInfoWithIgsCue, buildM1Index, buildM1MovieObject, buildM1PlaylistWithAudioPid } from "@bdmv2web/test-fixtures";
import { parseBdmv } from "@bdmv2web/bdmv-parser";
import { buildNavigationGraph, decodeInstruction, HdmvVm } from "@bdmv2web/hdmv";
import { m3Fixtures } from "@bdmv2web/test-fixtures";
import { extractIgsScenes } from "../../src/scene/extract.js";
import { syntheticClip, syntheticMenuSegments } from "../helpers/fixtures.js";

describe("M1 to M2/M3 consumer handoff", () => {
  it("keeps entry, track and raw command identities and source locations across consumers", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bdmv m1 m2 m3 integration "));
    const root = join(parent, "BDMV");
    try {
      for (const dir of ["PLAYLIST", "CLIPINF", "STREAM"]) await mkdir(join(root, dir), { recursive: true });
      await writeFile(join(root, "index.bdmv"), buildM1Index());
      await writeFile(join(root, "MovieObject.bdmv"), buildM1MovieObject());
      await writeFile(join(root, "PLAYLIST", "00001.mpls"), buildM1PlaylistWithAudioPid());
      await writeFile(join(root, "CLIPINF", "00001.clpi"), buildM1ClipInfoWithIgsCue());
      const buttonCommand = Uint8Array.from(m3Fixtures.move5.bytes.match(/../g)!, (byte) => Number.parseInt(byte, 16));
      await writeFile(join(root, "STREAM", "00001.m2ts"), syntheticClip({ buttonCommand }));

      const disc = await parseBdmv(root);
      const entry = disc.entries.find((item) => item.kind === "firstPlay")!;
      expect(entry.target).toMatchObject({ objectType: "HDMV", target: 0 });
      expect(entry.source).toMatchObject({ path: "index.bdmv", origin: "primary", offset: "92" });
      expect(disc.graph.edges).toContainEqual({ from: "entry:firstPlay:0", to: "movieObject:0", kind: "entry-target", resolution: "resolved", source: entry.source });

      const playlist = disc.playlists.find((item) => item.id === "00001")!;
      const declaredTrack = playlist.playItems[0]!.streams.find((stream) => stream.pid === 0x1100)!;
      const clipTrack = disc.clips.find((clip) => clip.id === "00001")!.programs[0]!.streams.find((stream) => stream.pid === declaredTrack.pid)!;
      expect(declaredTrack).toMatchObject({ codingType: 0x80, source: { path: "PLAYLIST/00001.mpls", origin: "primary", offset: "140" } });
      expect(clipTrack).toMatchObject({ pid: declaredTrack.pid, codingType: declaredTrack.codingType, source: { path: "CLIPINF/00001.clpi", origin: "primary", offset: "74" } });
      expect(disc.diagnostics.some((item) => item.code === "BDMV_STN_CLPI_PID_CONFLICT" || item.code === "BDMV_STN_CLPI_CODING_CONFLICT")).toBe(false);

      const instruction = disc.movieObjects[0]!.instructions[0]!;
      expect(instruction.source).toMatchObject({ path: "MovieObject.bdmv", origin: "primary", offset: "54" });
      const navigation = buildNavigationGraph(disc.movieObjects);
      expect(navigation.nodes.find((node) => node.id === "command:0:0")?.source).toEqual(instruction.source);
      expect(instruction.bytes).toBe("0102030405060708090a0b0c");
      const m1Decoded = decodeInstruction(instruction);
      expect(m1Decoded.bytes).toBe(instruction.bytes);

      const extraction = await extractIgsScenes(disc);
      expect(extraction.scenes).toHaveLength(1);
      expect(extraction.scenes[0]).toMatchObject({ clipId: "00001", pid: 0x120, source: { clipId: "00001", pid: 0x120, packetOffset: "384" } });
      expect(extraction.diagnostics.some((item) => item.code === "IGS_PID_CONFLICT")).toBe(false);
      const scene = extraction.scenes[0]!;
      const button = scene.pages[0]!.buttons[0]!;
      expect(button.commands).toHaveLength(1);
      const command = button.commands[0]!;
      expect(command.bytes.byteLength).toBe(12);
      expect(command.recordIndex).toBe(0);
      expect(command.sourceOffset).toBe(String(BigInt(scene.source.segmentFileOffset) + BigInt(findBytes(syntheticMenuSegments({ buttonCommand }), buttonCommand))));
      expect(button.visuals.selected.soundId).toBe(6);
      expect(button.visuals.activated.soundId).toBe(9);
      const streamSource = disc.graph.nodes.find((node) => node.id === "clip:00001")!.source!;
      const commandSource = { ...streamSource, offset: command.sourceOffset };
      const buttonDecoded = decodeInstruction(command.bytes, commandSource);
      expect(buttonDecoded.bytes).toBe(m3Fixtures.move5.bytes);
      expect(buttonDecoded.source).toEqual(commandSource);
      const vm = new HdmvVm([{ id: 0, instructions: [m3Fixtures.break] }]);
      vm.executeButtonCommand(command.bytes, commandSource, "ig_object");
      expect(vm.trace.at(-1)).toMatchObject({ raw: m3Fixtures.move5.bytes, source: commandSource, decoded: expect.stringContaining("MOVE") });
      expect(vm.snapshot().registers.gpr[0]).toBe(5);
      expect(disc.analysisStage).toBe("structural");
      expect(disc.supportPrediction.status).toBe("partial");
      expect(disc.supportPrediction.supported).toEqual([]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
