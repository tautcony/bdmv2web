import { DEFAULT_LIMITS, type Limits } from "@bdmv-web/core";
import type { IgsDiagnostic, PtsValue, TsPacket } from "./types.js";

const SYNC = 0x47;
const MAX_PTS = 1n << 33n;

export class M2tsPacketReader {
  private pending = new Uint8Array();
  private baseOffset = 0n;
  private readonly continuity = new Map<number, { cc: number; payload: Uint8Array }>();
  readonly diagnostics: IgsDiagnostic[] = [];

  constructor(private readonly clipId: string, private readonly limits: Limits = DEFAULT_LIMITS) {}

  feed(chunk: Uint8Array): TsPacket[] {
    if (chunk.byteLength > this.limits.maxReadWindowBytes) {
      this.diagnostics.push(diag("LIMIT_EXCEEDED", `Read chunk ${chunk.byteLength} exceeds maxReadWindowBytes ${this.limits.maxReadWindowBytes}`));
      return [];
    }
    const joined = new Uint8Array(this.pending.length + chunk.length);
    joined.set(this.pending); joined.set(chunk, this.pending.length);
    this.pending = joined;
    const packets: TsPacket[] = [];
    let consumed = 0;
    while (this.pending.length - consumed >= 192) {
      if (this.pending[consumed + 4] !== SYNC) {
        const next = this.findSync(consumed + 1);
        if (next < 0) {
          // Keep enough bytes to recognize a 192-byte boundary split over the next read.
          const discard = Math.max(0, this.pending.length - consumed - 195);
          if (discard === 0) break;
          this.diagnostics.push(diag("TS_SYNC_LOST", `No 192-byte M2TS sync at file offset ${this.baseOffset + BigInt(consumed)}`));
          consumed += discard;
          continue;
        }
        this.diagnostics.push(diag("TS_SYNC_LOST", `Resynchronized after ${next - consumed} bytes`, this.baseOffset + BigInt(consumed)));
        consumed = next;
        if (this.pending.length - consumed < 192) break;
        if (this.pending[consumed + 4] !== SYNC) continue;
      }
      const offset = this.baseOffset + BigInt(consumed);
      const packet = this.parsePacket(this.pending.subarray(consumed, consumed + 192), offset);
      if (packet) packets.push(packet);
      consumed += 192;
    }
    if (consumed) {
      this.pending = this.pending.slice(consumed);
      this.baseOffset += BigInt(consumed);
    }
    return packets;
  }

  end(): void {
    if (this.pending.length) {
      this.diagnostics.push(diag("TS_TRUNCATED_PACKET", `EOF with ${this.pending.length} residual bytes`, this.baseOffset));
      this.pending = new Uint8Array();
    }
  }

  private findSync(from: number): number {
    for (let i = from; i + 4 < this.pending.length; i++) {
      if (this.pending[i + 4] !== SYNC) continue;
      if (i + 196 >= this.pending.length || this.pending[i + 196] === SYNC) return i;
    }
    return -1;
  }

  private parsePacket(raw: Uint8Array, packetOffset: bigint): TsPacket | null {
    const p = raw.subarray(4);
    if (p[0] !== SYNC) return null;
    const b1 = p[1]!, b2 = p[2]!, b3 = p[3]!;
    const transportError = !!(b1 & 0x80);
    const payloadUnitStart = !!(b1 & 0x40);
    const pid = ((b1 & 0x1f) << 8) | b2;
    const adaptationControl = (b3 >> 4) & 3;
    const continuityCounter = b3 & 15;
    if (adaptationControl === 0) {
      this.diagnostics.push(diag("TS_INVALID_ADAPTATION_CONTROL", `PID ${pid} has reserved adaptation_control`, packetOffset, pid));
      return null;
    }
    let offset = 4;
    let discontinuity = false;
    if (adaptationControl & 2) {
      const length = p[offset]!;
      if (length > 183 || offset + 1 + length > 188) {
        this.diagnostics.push(diag("TS_INVALID_ADAPTATION_FIELD", `PID ${pid} adaptation field exceeds packet`, packetOffset, pid));
        return null;
      }
      if (length) discontinuity = !!(p[offset + 1]! & 0x80);
      offset += 1 + length;
    }
    const hasPayload = !!(adaptationControl & 1) && offset < 188;
    const payload = hasPayload ? p.slice(offset, 188) : new Uint8Array();
    let continuityError = false;
    if (transportError) this.diagnostics.push(diag("TS_TRANSPORT_ERROR", `PID ${pid} packet has transport_error_indicator`, packetOffset, pid));
    if (hasPayload && !transportError) {
      const previous = this.continuity.get(pid);
      if (discontinuity) this.continuity.delete(pid);
      else if (previous) {
        if (continuityCounter === previous.cc) {
          if (sameBytes(payload, previous.payload)) {
            this.diagnostics.push(diag("TS_DUPLICATE_PACKET", `PID ${pid} repeated continuity counter ${continuityCounter}`, packetOffset, pid, "info"));
            return null;
          }
          this.diagnostics.push(diag("TS_CONTINUITY_ERROR", `PID ${pid} changed payload without advancing CC ${continuityCounter}`, packetOffset, pid));
          continuityError = true;
        } else if (continuityCounter !== ((previous.cc + 1) & 15)) {
          this.diagnostics.push(diag("TS_CONTINUITY_ERROR", `PID ${pid} expected CC ${(previous.cc + 1) & 15}, got ${continuityCounter}`, packetOffset, pid));
          continuityError = true;
        }
      }
      this.continuity.set(pid, { cc: continuityCounter, payload: payload.slice() });
    }
    return { packetOffset, payloadOffset: offset, pid, payloadUnitStart, continuityCounter, hasPayload, discontinuity, transportError, continuityError, payload };
  }

  private diag(code: string, message: string, offset?: bigint, pid?: number, severity: IgsDiagnostic["severity"] = "error"): IgsDiagnostic {
    return { severity, code, message, source: offset === undefined || pid === undefined ? null : source(this.clipId, pid, offset), affectedSceneIds: [] };
  }
}

export interface PsiSection { pid: number; tableId: number; bytes: Uint8Array; packetOffset: bigint; }

export class PsiAssembler {
  private readonly buffers = new Map<number, Uint8Array>();
  readonly programs = new Map<number, number>();
  readonly streamsByPid = new Map<number, number>();
  readonly streamSourcesByPid = new Map<number, ReturnType<typeof source>>();
  constructor(readonly diagnostics: IgsDiagnostic[], private readonly clipId: string) {}

  push(packet: TsPacket): PsiSection[] {
    if (packet.transportError || packet.continuityError || packet.discontinuity) {
      if (packet.pid === 0 || this.programsHasPid(packet.pid) || this.buffers.has(packet.pid)) {
        this.buffers.delete(packet.pid);
        if (packet.pid === 0) this.programs.clear();
        this.streamsByPid.clear();
        this.streamSourcesByPid.clear();
        const reason = packet.discontinuity ? "discontinuity" : packet.transportError ? "transport error" : "continuity error";
        this.diagnostics.push({ severity: "error", code: "PSI_INVALIDATED", message: `PID ${packet.pid} ${reason} discarded the pending PSI section`, source: source(this.clipId, packet.pid, packet.packetOffset), affectedSceneIds: [] });
      }
      return [];
    }
    if (!packet.hasPayload) {
      return [];
    }
    if (packet.pid !== 0 && !this.programsHasPid(packet.pid)) return [];
    let payload = packet.payload;
    let prior = this.buffers.get(packet.pid) ?? new Uint8Array();
    if (packet.payloadUnitStart) {
      if (!payload.length) return [];
      const pointer = payload[0]!;
      if (pointer + 1 > payload.length) { this.buffers.delete(packet.pid); this.diagnostics.push({ severity: "error", code: "PSI_INVALID_POINTER", message: "PSI pointer field exceeds payload", source: source(this.clipId, packet.pid, packet.packetOffset), affectedSceneIds: [] }); return []; }
      if (pointer && prior.length) prior = append(prior, payload.subarray(1, pointer + 1));
      payload = payload.subarray(pointer + 1);
    } else if (!prior.length) return [];
    const bytes = append(prior, payload);
    const sections: PsiSection[] = [];
    let cursor = 0;
    while (bytes.length - cursor >= 3) {
      if (bytes[cursor] === 0xff) break;
      const len = ((bytes[cursor + 1]! & 15) << 8) | bytes[cursor + 2]!;
      const total = 3 + len;
      if (len < 4 || total > this.limitsMax()) { this.buffers.delete(packet.pid); this.diagnostics.push({ severity: "error", code: "PSI_INVALID_LENGTH", message: `PSI section length ${len} is invalid`, source: source(this.clipId, packet.pid, packet.packetOffset), affectedSceneIds: [] }); return sections; }
      if (bytes.length - cursor < total) break;
      const section = bytes.slice(cursor, cursor + total);
      sections.push({ pid: packet.pid, tableId: section[0]!, bytes: section, packetOffset: packet.packetOffset });
      this.process(section, packet.pid, packet.packetOffset);
      cursor += total;
    }
    this.buffers.set(packet.pid, bytes.slice(cursor));
    return sections;
  }

  private programsHasPid(pid: number): boolean { return [...this.programs.values()].includes(pid); }
  private limitsMax(): number { return 4096; }
  private process(section: Uint8Array, pid: number, at: bigint): void {
    if (!mpegCrcOkay(section)) { this.diagnostics.push({ severity: "warning", code: "PSI_CRC_INVALID", message: `PID ${pid} section CRC failed`, source: source(this.clipId, pid, at), affectedSceneIds: [] }); return; }
    if (pid === 0 && section[0] === 0x00) {
      for (let i = 8; i + 4 <= section.length - 4; i += 4) {
        const program = (section[i]! << 8) | section[i + 1]!;
        const pmtPid = ((section[i + 2]! & 31) << 8) | section[i + 3]!;
        if (program) this.programs.set(program, pmtPid);
      }
    } else if (section[0] === 0x02) {
      const infoLength = ((section[10]! & 15) << 8) | section[11]!;
      let i = 12 + infoLength;
      while (i + 5 <= section.length - 4) {
        const type = section[i]!;
        const streamPid = ((section[i + 1]! & 31) << 8) | section[i + 2]!;
        const esLen = ((section[i + 3]! & 15) << 8) | section[i + 4]!;
        if (i + 5 + esLen > section.length - 4) break;
        this.streamsByPid.set(streamPid, type);
        this.streamSourcesByPid.set(streamPid, source(this.clipId, pid, at));
        i += 5 + esLen;
      }
    }
  }
}

export interface PesPacket {
  pid: number;
  packetOffset: bigint;
  pesOffset: bigint;
  payloadOffset: bigint;
  pts: PtsValue | null;
  dtsRaw: bigint | null;
  payload: Uint8Array;
  timeDomain: number;
}

export class PesAssembler {
  private readonly pending = new Map<number, { bytes: Uint8Array; start: bigint; pesOffset: bigint; corrupt: boolean }>();
  private readonly clocks = new Map<number, { lastRaw: bigint; epoch: bigint; domain: number; explicitDiscontinuity: boolean }>();
  private activeBytes = 0;
  readonly diagnostics: IgsDiagnostic[] = [];
  constructor(private readonly clipId: string, private readonly limits: Limits = DEFAULT_LIMITS) {}

  push(packet: TsPacket): PesPacket[] {
    if (packet.discontinuity) {
      const pending = this.pending.get(packet.pid);
      if (pending) {
        this.activeBytes -= pending.bytes.length;
        this.pending.delete(packet.pid);
        this.diagnostics.push({ severity: "error", code: "PES_INVALIDATED", message: `PID ${packet.pid} discontinuity invalidated the pending PES`, source: source(this.clipId, packet.pid, packet.packetOffset), affectedSceneIds: [] });
      }
      this.clocks.set(packet.pid, { lastRaw: 0n, epoch: 0n, domain: (this.clocks.get(packet.pid)?.domain ?? 0) + 1, explicitDiscontinuity: true });
    }
    if (packet.transportError || packet.continuityError) {
      this.drop(packet.pid, packet.packetOffset, "PES_INVALIDATED", "Transport damage invalidated the pending PES");
      return [];
    }
    const out: PesPacket[] = [];
    if (packet.payloadUnitStart) {
      const old = this.pending.get(packet.pid);
      if (old) {
        const declared = old.bytes.length >= 6 ? ((old.bytes[4]! << 8) | old.bytes[5]!) : 0;
        if (declared && old.bytes.length < declared + 6) {
          this.diagnostics.push({ severity: "error", code: "PES_INVALIDATED", message: `PID ${packet.pid} new PUSI arrived before prior PES declared length ${declared + 6} was reached`, source: source(this.clipId, packet.pid, old.start), affectedSceneIds: [] });
        } else {
          const complete = this.finish(packet.pid, old, declared ? declared + 6 : undefined);
          if (complete) out.push(complete);
        }
        this.activeBytes -= old.bytes.length;
      }
      if (!packet.hasPayload || packet.payload.length < 6) return out;
      this.pending.set(packet.pid, { bytes: packet.payload.slice(), start: packet.packetOffset, pesOffset: packet.packetOffset + 4n + BigInt(packet.payloadOffset), corrupt: false });
      this.activeBytes += packet.payload.length;
      if (this.activeBytes > this.limits.maxReassemblyBytes || packet.payload.length > this.limits.maxSegmentBytes) {
        this.drop(packet.pid, packet.packetOffset, "LIMIT_EXCEEDED", "PES start exceeds configured reassembly byte limit");
        return out;
      }
    } else {
      const current = this.pending.get(packet.pid);
      if (!current || !packet.hasPayload) return out;
      if (current.bytes.length + packet.payload.length > this.limits.maxSegmentBytes || this.activeBytes + packet.payload.length > this.limits.maxReassemblyBytes) {
        this.drop(packet.pid, packet.packetOffset, "LIMIT_EXCEEDED", "PES reassembly exceeded configured byte limit");
        return out;
      }
      const next = append(current.bytes, packet.payload);
      this.activeBytes += packet.payload.length;
      current.bytes = next;
    }
    const current = this.pending.get(packet.pid);
    if (current && current.bytes.length >= 6) {
      const declared = (current.bytes[4]! << 8) | current.bytes[5]!;
      if (declared > this.limits.maxSegmentBytes - 6) {
        this.drop(packet.pid, packet.packetOffset, "LIMIT_EXCEEDED", `PES declared length ${declared + 6} exceeds maxSegmentBytes ${this.limits.maxSegmentBytes}`);
        return out;
      }
      if (declared > 0 && current.bytes.length >= declared + 6) {
        const complete = this.finish(packet.pid, current, declared + 6);
        if (complete) out.push(complete);
        this.activeBytes -= current.bytes.length;
        this.pending.delete(packet.pid);
      }
    }
    return out;
  }

  end(): void {
    for (const [pid, current] of this.pending) {
      this.diagnostics.push({ severity: "warning", code: "PES_TRUNCATED_EOF", message: `PID ${pid} has ${current.bytes.length} pending PES bytes at EOF`, source: source(this.clipId, pid, current.start), affectedSceneIds: [] });
    }
    this.pending.clear(); this.activeBytes = 0;
  }

  private finish(pid: number, current: { bytes: Uint8Array; start: bigint; pesOffset: bigint; corrupt: boolean }, declaredTotal?: number): PesPacket | null {
    const bytes = declaredTotal ? current.bytes.subarray(0, declaredTotal) : current.bytes;
    if (bytes.length < 9 || bytes[0] !== 0 || bytes[1] !== 0 || bytes[2] !== 1) {
      this.diagnostics.push({ severity: "error", code: "PES_INVALID_HEADER", message: `PID ${pid} PES start code/header is invalid`, source: source(this.clipId, pid, current.start), affectedSceneIds: [] });
      return null;
    }
    const flags = bytes[7]! >> 6; const headerLen = bytes[8]!;
    const payloadStart = 9 + headerLen;
    if (payloadStart > bytes.length || ((flags === 2 || flags === 3) && headerLen < (flags === 3 ? 10 : 5))) {
      this.diagnostics.push({ severity: "error", code: "PES_INVALID_HEADER", message: `PID ${pid} PES optional header is truncated`, source: source(this.clipId, pid, current.start), affectedSceneIds: [] });
      return null;
    }
    let pts: PtsValue | null = null; let dtsRaw: bigint | null = null;
    if (flags === 2 || flags === 3) {
      const raw = decodeTimestamp(bytes.subarray(9, 14));
      if (raw === null) this.diagnostics.push({ severity: "error", code: "PES_INVALID_TIMESTAMP", message: `PID ${pid} PTS marker bits are invalid`, source: source(this.clipId, pid, current.start), affectedSceneIds: [] });
      if (flags === 3) dtsRaw = decodeTimestamp(bytes.subarray(14, 19));
      if (raw !== null) pts = this.unwrap(pid, raw, current.start, dtsRaw ?? raw);
    }
    return { pid, packetOffset: current.start, pesOffset: current.pesOffset, payloadOffset: current.pesOffset + BigInt(payloadStart), pts, dtsRaw, payload: bytes.slice(payloadStart), timeDomain: pts?.timeDomain ?? this.clocks.get(pid)?.domain ?? 0 };
  }

  private unwrap(pid: number, raw: bigint, at: bigint, clock: bigint): PtsValue {
    let state = this.clocks.get(pid);
    if (!state) state = { lastRaw: clock, epoch: 0n, domain: 0, explicitDiscontinuity: false };
    else if (state.explicitDiscontinuity) { state = { lastRaw: clock, epoch: 0n, domain: state.domain, explicitDiscontinuity: false }; }
    else if (clock < state.lastRaw && state.lastRaw - clock > MAX_PTS / 2n) state = { ...state, epoch: state.epoch + 1n, lastRaw: clock };
    else if (clock < state.lastRaw && state.lastRaw - clock > 90_000n) {
      state = { lastRaw: clock, epoch: 0n, domain: state.domain + 1, explicitDiscontinuity: false };
      this.diagnostics.push({ severity: "warning", code: "PTS_TIME_DOMAIN_RESET", message: `PID ${pid} PTS moved backwards without a near-wrap transition; starting a new inferred time domain`, source: source(this.clipId, pid, at), affectedSceneIds: [] });
    } else state = { ...state, lastRaw: clock };
    this.clocks.set(pid, state);
    return { raw, epoch: state.epoch, normalized: state.epoch * MAX_PTS + raw, timeDomain: state.domain };
  }

  private drop(pid: number, offset: bigint, code: string, message: string): void {
    const old = this.pending.get(pid);
    if (old) this.activeBytes -= old.bytes.length;
    this.pending.delete(pid);
    this.diagnostics.push({ severity: "error", code, message: `PID ${pid}: ${message}`, source: source(this.clipId, pid, offset), affectedSceneIds: [] });
  }
}

export function decodeTimestamp(bytes: Uint8Array): bigint | null {
  if (bytes.length < 5 || (bytes[0]! & 1) !== 1 || (bytes[2]! & 1) !== 1 || (bytes[4]! & 1) !== 1) return null;
  return (BigInt((bytes[0]! >> 1) & 7) << 30n) | (BigInt(bytes[1]!) << 22n) | (BigInt(bytes[2]! >> 1) << 15n) | (BigInt(bytes[3]!) << 7n) | BigInt(bytes[4]! >> 1);
}

export function encodeTimestampForFixture(value: bigint, prefix = 2): Uint8Array {
  return Uint8Array.of(((prefix & 15) << 4) | (Number(value >> 30n) & 7) << 1 | 1, Number(value >> 22n) & 255, (Number(value >> 15n) & 127) << 1 | 1, Number(value >> 7n) & 255, (Number(value) & 127) << 1 | 1);
}

export function source(clipId: string, pid: number, packetOffset: bigint, pesOffset = packetOffset + 4n, segmentOffset = 0n, pts90k: string | null = null, timeDomain = 0, segmentFileOffset = packetOffset) {
  return { clipId, pid, packetOffset: packetOffset.toString(), pesOffset: pesOffset.toString(), segmentOffset: segmentOffset.toString(), segmentFileOffset: segmentFileOffset.toString(), pts90k, timeDomain };
}

function diag(code: string, message: string, offset?: bigint, pid?: number, severity: IgsDiagnostic["severity"] = "error"): IgsDiagnostic {
  return { severity, code, message, source: offset === undefined || pid === undefined ? null : source("", pid, offset), affectedSceneIds: [] };
}
function append(a: Uint8Array, b: Uint8Array): Uint8Array { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; }
function sameBytes(a: Uint8Array, b: Uint8Array): boolean { return a.length === b.length && a.every((v, i) => v === b[i]); }
function mpegCrcOkay(data: Uint8Array): boolean { let crc = 0xffffffff; for (const byte of data) { crc ^= byte << 24; for (let i = 0; i < 8; i++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1; crc >>>= 0; } return crc === 0; }
