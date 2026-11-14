import { describe, expect, it } from "vitest";
import { probeTransportStreams } from "./probe.js";
import { patPacket, pmtPacketWithStreams, pmtPacketWithBadCrc, chunks } from "../../tests/helpers/fixtures.js";

const PGS_PID = 0x1200;
const IGS_PID = 0x1100;

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

describe("probeTransportStreams", () => {
  it("reports the declared streams of the first PMT, including reserved-PID declarations", async () => {
    const bytes = concat(patPacket(), pmtPacketWithStreams([{ pid: PGS_PID, type: 0x90 }, { pid: 0, type: 0x81 }, { pid: IGS_PID, type: 0x91 }]));
    const probe = await probeTransportStreams("probe", chunks(bytes, 7));
    expect(probe.hasProgramTables).toBe(true);
    expect([...probe.streamsByPid]).toEqual([[PGS_PID, 0x90], [0, 0x81], [IGS_PID, 0x91]]);
    expect(probe.diagnostics).toEqual([]);
  });

  it("keeps discovering streams when the PMT CRC is invalid and reports the failure", async () => {
    const bytes = concat(patPacket(), pmtPacketWithBadCrc([{ pid: PGS_PID, type: 0x90 }]));
    const probe = await probeTransportStreams("probe", chunks(bytes, 192));
    expect(probe.hasProgramTables).toBe(true);
    expect([...probe.streamsByPid]).toEqual([[PGS_PID, 0x90]]);
    expect(probe.diagnostics.map((d) => d.code)).toContain("PSI_CRC_INVALID");
  });

  it("scans the whole input so trailing garbage shows up in the diagnostics", async () => {
    const bytes = concat(patPacket(), pmtPacketWithStreams([{ pid: PGS_PID, type: 0x90 }]), new Uint8Array(384).fill(0x55));
    const probe = await probeTransportStreams("probe", chunks(bytes, 192));
    expect(probe.hasProgramTables).toBe(true);
    expect([...probe.streamsByPid]).toEqual([[PGS_PID, 0x90]]);
    expect(probe.diagnostics.map((d) => d.code)).toContain("TS_SYNC_LOST");
  });

  it("keeps the first declaration snapshot when later damage clears the live PSI state", async () => {
    const junk = new Uint8Array(192).fill(0x55);
    const bytes = concat(patPacket(), pmtPacketWithStreams([{ pid: PGS_PID, type: 0x90 }]), junk);
    const probe = await probeTransportStreams("probe", chunks(bytes, 96));
    expect(probe.hasProgramTables).toBe(true);
    expect([...probe.streamsByPid]).toEqual([[PGS_PID, 0x90]]);
  });

  it("reports no program tables for a PAT-only stream", async () => {
    const probe = await probeTransportStreams("probe", chunks(patPacket(), 192));
    expect(probe.hasProgramTables).toBe(false);
    expect(probe.streamsByPid.size).toBe(0);
  });

  it("reports no program tables for input that is not an m2ts stream", async () => {
    const probe = await probeTransportStreams("probe", chunks(new Uint8Array(1024).fill(0x55), 192));
    expect(probe.hasProgramTables).toBe(false);
    expect(probe.diagnostics.map((d) => d.code)).toContain("TS_SYNC_LOST");
  });
});
