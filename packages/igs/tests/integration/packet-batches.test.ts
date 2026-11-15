import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "@bdmv2web/core";
import { extractIgsFromChunks, extractIgsFromPacketBatches } from "../../src/scene/extract.js";
import { probeTransportStreamPrefix, probeTransportStreams } from "../../src/transport/probe.js";
import { M2tsPacketReader } from "../../src/transport/transport.js";
import type { TsPacket } from "../../src/scene/types.js";
import { chunks, IG_PID, syntheticClip } from "../helpers/fixtures.js";

const cues = [{ pid: IG_PID, source: { path: "BDMV/PLAYLIST/00001.mpls", origin: "primary" as const, offset: "0" } }];

describe("packet-batch IGS extraction", () => {
  it("stops the prefix probe at the first PMT and reports its declarations", async () => {
    const bytes = syntheticClip();
    const full = await probeTransportStreams("00001", chunks(bytes, 13));
    let pulled = 0;
    async function* counted(): AsyncGenerator<Uint8Array> {
      for await (const chunk of chunks(bytes, 13)) { pulled++; yield chunk; }
    }
    const prefix = await probeTransportStreamPrefix("00001", counted());

    expect(prefix.hasProgramTables).toBe(true);
    expect([...prefix.streamsByPid]).toEqual([...full.streamsByPid]);
    expect(prefix.diagnostics).toEqual([]);
    expect(pulled).toBeLessThan(Math.ceil(bytes.byteLength / 13));
  });

  it("matches chunk extraction when an outer reader supplies the packets", async () => {
    const bytes = syntheticClip();
    const fromChunks = await extractIgsFromChunks("00001", chunks(bytes, 13), cues);
    const reader = new M2tsPacketReader("00001", DEFAULT_LIMITS);
    async function* batches(): AsyncGenerator<readonly TsPacket[]> {
      for await (const chunk of chunks(bytes, 13)) yield reader.feed(chunk);
      reader.end();
    }
    const fromBatches = await extractIgsFromPacketBatches("00001", batches(), cues, {}, reader.diagnostics);

    expect(fromBatches.scenes).toEqual(fromChunks.scenes);
    expect(fromBatches.streams).toEqual(fromChunks.streams);
    expect(fromBatches.diagnostics).toEqual(fromChunks.diagnostics);
    expect(fromBatches.status).toBe(fromChunks.status);
  });
});
