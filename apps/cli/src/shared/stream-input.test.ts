import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyStreamInput, discoverGraphicsStreams } from "./stream-input.js";
import { PGS_PID, syntheticNonStreamBytes, syntheticPgsStream } from "../../tests/helpers/synthetic-streams.js";

describe("classifyStreamInput", () => {
  it("classifies .rsks/.m2ts files as stream input with a safe stem", async () => {
    const parent = await mkdtemp(join(tmpdir(), "stream-input "));
    try {
      const rsks = join(parent, "00005.SumiSora.sc.rsks");
      await writeFile(rsks, syntheticPgsStream({ displaySets: 1 }));
      await expect(classifyStreamInput(rsks)).resolves.toEqual({ kind: "stream", path: rsks, stem: "00005.SumiSora.sc" });
      const m2ts = join(parent, "CLIP.M2TS");
      await writeFile(m2ts, syntheticPgsStream({ displaySets: 1 }));
      await expect(classifyStreamInput(m2ts)).resolves.toEqual({ kind: "stream", path: m2ts, stem: "CLIP" });
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("keeps directories and other files on the BDMV input path", async () => {
    const parent = await mkdtemp(join(tmpdir(), "stream-input "));
    try {
      await expect(classifyStreamInput(parent)).resolves.toEqual({ kind: "bdmv" });
      const notes = join(parent, "notes.txt");
      await writeFile(notes, "text");
      await expect(classifyStreamInput(notes)).resolves.toEqual({ kind: "bdmv" });
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
});

describe("discoverGraphicsStreams", () => {
  it("discovers declared PGS and IGS PIDs and ignores reserved PIDs", async () => {
    const parent = await mkdtemp(join(tmpdir(), "stream-discovery "));
    try {
      const stream = join(parent, "clip.rsks");
      await writeFile(stream, syntheticPgsStream({ pmtEntries: [{ pid: PGS_PID, type: 0x90 }, { pid: 0, type: 0x81 }, { pid: 0x110, type: 0x91 }] }));
      const discovery = await discoverGraphicsStreams(stream);
      expect(discovery.pgsPids).toEqual([PGS_PID]);
      expect(discovery.igsPids).toEqual([0x110]);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("fails a file that never carries program tables", async () => {
    const parent = await mkdtemp(join(tmpdir(), "stream-discovery "));
    try {
      const garbage = join(parent, "garbage.rsks");
      await writeFile(garbage, syntheticNonStreamBytes());
      await expect(discoverGraphicsStreams(garbage)).rejects.toMatchObject({ code: "EXPORT_INVALID_STREAM", path: garbage });
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
});
