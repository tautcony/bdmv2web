import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { M2tsPacketReader, PesAssembler } from "@bdmv2web/igs";
import type { PesPacket } from "@bdmv2web/igs";
import { parsePgsSup } from "./pgs.js";

export interface ExtractedPgsTrack { pid: number; sourcePath: string; path: string; byteLength: number; displaySets: ReturnType<typeof parsePgsSup>; }
export interface PgsTrackRequest { pid: number; outputPath: string; timestampOffset90k?: bigint; }
export interface ExtractPgsTracksOptions { maxBytes?: number; }

interface PgsTrackState {
  pid: number;
  output: string;
  temporaryOutput: string;
  backupOutput?: string;
  timestampOffset90k: bigint;
  maxBytes: number | undefined;
  file?: FileHandle;
  temporaryCreated: boolean;
  buffer: Uint8Array;
  bufferedBytes: number;
  byteLength: number;
  effectiveTimestampOffset90k: bigint;
  hasTimestampAnchor: boolean;
  hasDtsAnchor: boolean;
}

/** Extract requested Blu-ray PGS PID and source intervals from one clip scan. */
export async function extractPgsTracks(sourcePath: string, requests: readonly PgsTrackRequest[], options: ExtractPgsTracksOptions = {}): Promise<ExtractedPgsTrack[]> {
  const maxBytes = options.maxBytes;
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)) throw new RangeError("maxBytes must be a positive safe integer.");
  const source = resolve(sourcePath);
  const outputs = new Set<string>();
  const states: PgsTrackState[] = requests.map((request) => {
    validatePid(request.pid);
    const timestampOffset90k = request.timestampOffset90k ?? 0n;
    if (timestampOffset90k < 0n) throw new RangeError("timestampOffset90k must be non-negative.");
    const output = resolve(request.outputPath);
    if (output === source) throw new TypeError("PGS output path must differ from the source clip path.");
    if (outputs.has(output)) throw new TypeError(`PGS output path is requested more than once: '${output}'.`);
    outputs.add(output);
    return { pid: request.pid, output, temporaryOutput: `${output}.bdmv2web-${randomUUID()}.tmp`, timestampOffset90k, maxBytes, temporaryCreated: false, buffer: new Uint8Array(256 * 1024), bufferedBytes: 0, byteLength: 0, effectiveTimestampOffset90k: timestampOffset90k, hasTimestampAnchor: false, hasDtsAnchor: false };
  });
  if (states.length === 0) return [];

  const statesByPid = new Map<number, PgsTrackState[]>();
  for (const state of states) {
    const group = statesByPid.get(state.pid) ?? [];
    group.push(state);
    statesByPid.set(state.pid, group);
  }
  const pids = new Set(statesByPid.keys());
  const reader = new M2tsPacketReader("pgs-extraction");
  const assembler = new PesAssembler("pgs-extraction");
  const accept = async (pesPackets: PesPacket[]) => {
    for (const pes of pesPackets) {
      for (const state of statesByPid.get(pes.pid) ?? []) await appendPes(state, pes);
    }
  };

  try {
    for (const state of states) {
      await mkdir(resolve(state.output, ".."), { recursive: true });
      state.file = await open(state.temporaryOutput, "wx");
      state.temporaryCreated = true;
    }
    for await (const chunk of createReadStream(source, { highWaterMark: 256 * 1024 }) as AsyncIterable<Uint8Array>) {
      for (const packet of reader.feed(chunk)) if (pids.has(packet.pid)) await accept(assembler.push(packet));
    }
    reader.end();
    await accept(assembler.end());
    const transportError = reader.diagnostics.find((item) => item.source !== null && "pid" in item.source && item.source.pid !== null && pids.has(item.source.pid) && item.severity === "error");
    const pesError = assembler.diagnostics.find((item) => item.source !== null && "pid" in item.source && item.source.pid !== null && pids.has(item.source.pid) && item.severity === "error");
    if (transportError) throw new TypeError(`PGS PID ${transportError.source?.pid ?? "unknown"} transport stream is invalid: ${transportError.message}`);
    if (pesError) throw new TypeError(`PGS PID ${pesError.source?.pid ?? "unknown"} PES stream is invalid: ${pesError.message}`);

    const result: ExtractedPgsTrack[] = [];
    for (const state of states) {
      await flush(state);
      await state.file!.close();
      delete state.file;
      const bytes = await readFile(state.temporaryOutput);
      const displaySets = parsePgsSup(bytes);
      if (displaySets.length === 0) throw new TypeError(`Extracted PGS PID ${state.pid} contains no complete display sets.`);
      result.push({ pid: state.pid, sourcePath: source, path: state.output, byteLength: bytes.byteLength, displaySets });
    }

    try {
      for (const state of states) {
        const backupOutput = `${state.output}.bdmv2web-${randomUUID()}.bak`;
        try { await stat(state.output); await rename(state.output, backupOutput); state.backupOutput = backupOutput; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        await rename(state.temporaryOutput, state.output);
        state.temporaryOutput = "";
        state.temporaryCreated = false;
      }
    } catch (error) {
      await Promise.all(states.map(async (state) => {
        if (state.temporaryOutput === "") await unlink(state.output).catch(() => undefined);
        if (state.backupOutput) await rename(state.backupOutput, state.output).catch(() => undefined);
        delete state.backupOutput;
      }));
      throw error;
    }
    await Promise.all(states.map(async (state) => {
      if (state.backupOutput) await unlink(state.backupOutput).catch(() => undefined);
      delete state.backupOutput;
    }));
    return result;
  } catch (error) {
    await Promise.all(states.map(async (state) => {
      await state.file?.close().catch(() => undefined);
      if (state.temporaryCreated) await unlink(state.temporaryOutput).catch(() => undefined);
    }));
    throw error;
  }
}

/** Extract one declared Blu-ray PGS PID as SUP, then parse and validate every display set. */
export async function extractPgsTrack(sourcePath: string, pid: number, outputPath: string, options: { maxBytes?: number; timestampOffset90k?: bigint } = {}): Promise<ExtractedPgsTrack> {
  const [track] = await extractPgsTracks(sourcePath, [{ pid, outputPath, ...(options.timestampOffset90k !== undefined ? { timestampOffset90k: options.timestampOffset90k } : {}) }], options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {});
  return track!;
}

async function appendPes(state: PgsTrackState, pes: PesPacket): Promise<void> {
  if (!state.hasTimestampAnchor) {
    state.hasTimestampAnchor = true;
    const pts = pes.pts?.raw;
    // The reference SUP timestamp convention anchors a PGS stream near
    // the source interval to its first DTS, then keeps all later deltas.
    if (pts !== undefined && pes.dtsRaw !== null && pts > state.timestampOffset90k && pts - state.timestampOffset90k <= 180_000n) state.effectiveTimestampOffset90k = pes.dtsRaw;
  }
  let offset = 0;
  while (offset < pes.payload.length) {
    if (offset + 3 > pes.payload.length) throw new TypeError(`PGS PID ${state.pid} contains a truncated PES segment header.`);
    const length = (pes.payload[offset + 1]! << 8) | pes.payload[offset + 2]!;
    const end = offset + 3 + length;
    if (end > pes.payload.length) throw new TypeError(`PGS PID ${state.pid} contains a truncated PES segment payload.`);
    const pts = Number(((pes.pts?.raw ?? 0n) - state.effectiveTimestampOffset90k) & 0xffff_ffffn);
    const dts = pes.dtsRaw !== null
      ? Number((pes.dtsRaw - state.effectiveTimestampOffset90k) & 0xffff_ffffn)
      : state.hasDtsAnchor ? Number(((pes.pts?.raw ?? 0n) - state.effectiveTimestampOffset90k) & 0xffff_ffffn) : 0;
    if (pes.dtsRaw !== null) state.hasDtsAnchor = true;
    const record = new Uint8Array(13 + length);
    record.set([0x50, 0x47, pts >>> 24, pts >>> 16, pts >>> 8, pts, dts >>> 24, dts >>> 16, dts >>> 8, dts], 0);
    record.set(pes.payload.subarray(offset, end), 10);
    state.byteLength += record.byteLength;
    if (state.maxBytes !== undefined && state.byteLength > state.maxBytes) throw new RangeError(`Extracted PGS PID ${state.pid} exceeds maxBytes.`);
    await append(state, record);
    offset = end;
  }
}

async function append(state: PgsTrackState, bytes: Uint8Array): Promise<void> {
  if (bytes.byteLength > state.buffer.byteLength) {
    await flush(state);
    await writeFully(state.file!, bytes);
    return;
  }
  if (state.bufferedBytes + bytes.byteLength > state.buffer.byteLength) await flush(state);
  state.buffer.set(bytes, state.bufferedBytes);
  state.bufferedBytes += bytes.byteLength;
}

async function flush(state: PgsTrackState): Promise<void> {
  if (state.bufferedBytes === 0) return;
  await writeFully(state.file!, state.buffer.subarray(0, state.bufferedBytes));
  state.bufferedBytes = 0;
}

async function writeFully(file: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await file.write(bytes, offset, bytes.byteLength - offset, null);
    if (bytesWritten <= 0) throw new Error("PGS SUP output write made no progress.");
    offset += bytesWritten;
  }
}

function validatePid(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid < 0x20 || pid > 0x1ffe) throw new RangeError("PGS PID must be a valid 13-bit transport PID.");
}
