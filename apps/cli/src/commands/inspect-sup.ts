import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { bdmvRelativePath } from "@bdmv2web/core/disc-path";
import type { ParsedDisc } from "@bdmv2web/bdmv-parser";
import { M2tsPacketReader, PesAssembler, type PesPacket } from "@bdmv2web/igs";
import { parsePgsSup, pgsDisplaySetEnd90k, type PgsDisplaySet } from "@bdmv2web/media-export";
import { concatByteChunks, equalsIgnoreCase } from "@bdmv2web/utils";
import { selectedClip, selectedPid, type AssetSelection, type AssetType } from "../cli/assets.js";
import type { reachablePgsReferences } from "../shared/pgs.js";

export type SupReference = ReturnType<typeof reachablePgsReferences>[number] & { reachable?: boolean };

export function supStreamKey(clipId: string, pid: number, sourceIn90k: string): string {
  return `${clipId.toUpperCase()}:${pid}:${sourceIn90k}`;
}

export function format90kTimestamp(ticks: number | null | undefined): string {
  if (ticks === null || ticks === undefined || !Number.isFinite(ticks) || ticks < 0) return "unknown";
  const totalMs = Math.round((ticks / 90_000) * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor(totalMs / 60_000) % 60;
  const seconds = Math.floor(totalMs / 1000) % 60;
  const ms = totalMs % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

/**
 * Collects SUP (0x90) declarations for a clip across reachable navigation paths,
 * declared MPLS PlayItems/SubPaths (including dynamic GPR-dispatched playlists),
 * and CLPI program declarations.
 */
export function collectDeclaredSupForClip(
  disc: ParsedDisc,
  reachableSup: ReturnType<typeof reachablePgsReferences>,
  clipId: string,
  assetSelection: AssetSelection,
  assetType: AssetType,
): SupReference[] {
  if (assetType === "igs" || !selectedClip(clipId, assetSelection)) return [];
  const byKey = new Map<string, SupReference>();
  const pids = new Set<number>();

  for (const item of reachableSup) {
    if (!equalsIgnoreCase(item.clipId, clipId) || !selectedPid(item.pid, assetSelection)) continue;
    const key = supStreamKey(item.clipId, item.pid, item.sourceIn90k);
    byKey.set(key, { ...item, reachable: true });
    pids.add(item.pid);
  }

  for (const playlist of disc.playlists) {
    for (const item of playlist.playItems) {
      if (equalsIgnoreCase(item.clipId, clipId)) {
        const pgStreams = item.streams.filter((stream) => stream.codingType === 0x90 && stream.pid !== null && stream.streamType === 1);
        for (const [index, stream] of pgStreams.entries()) {
          if (!selectedPid(stream.pid!, assetSelection)) continue;
          const sourceIn90k = String(item.inTime45k * 2);
          const sourceOut90k = String(item.outTime45k * 2);
          const key = supStreamKey(item.clipId, stream.pid!, sourceIn90k);
          if (!byKey.has(key)) {
            byKey.set(key, {
              playlistId: playlist.id,
              playlistNumber: Number(playlist.id),
              playItemIndex: item.index,
              clipId: item.clipId,
              pid: stream.pid!,
              streamNumber: index + 1,
              language: stream.language ?? "und",
              sourceIn90k,
              sourceOut90k,
              source: `${stream.source.path} @ ${stream.source.offset} (${stream.source.origin})`,
              reachable: false,
            });
          }
          pids.add(stream.pid!);
        }
      }
      for (const [index, stream] of item.streams.filter((candidate) => candidate.codingType === 0x90 && candidate.pid !== null && candidate.streamType === 2).entries()) {
        if (!selectedPid(stream.pid!, assetSelection)) continue;
        const subClip = stream.subPathId !== null && stream.subClipId !== null
          ? playlist.subPaths[stream.subPathId]?.items[stream.subClipId]
          : undefined;
        if (!subClip || !equalsIgnoreCase(subClip.clipId, clipId)) continue;
        const sourceIn90k = String(subClip.inTime45k * 2);
        const sourceOut90k = String(subClip.outTime45k * 2);
        const key = supStreamKey(subClip.clipId, stream.pid!, sourceIn90k);
        if (!byKey.has(key)) {
          byKey.set(key, {
            playlistId: playlist.id,
            playlistNumber: Number(playlist.id),
            playItemIndex: item.index,
            clipId: subClip.clipId,
            pid: stream.pid!,
            streamNumber: index + 1,
            language: stream.language ?? "und",
            sourceIn90k,
            sourceOut90k,
            source: `${stream.source.path} @ ${stream.source.offset} (${stream.source.origin})`,
            reachable: false,
          });
        }
        pids.add(stream.pid!);
      }
    }
  }

  const clip = disc.clips.find((candidate) => equalsIgnoreCase(candidate.id, clipId));
  for (const [index, stream] of (clip?.programs.flatMap((program) => program.streams.filter((candidate) => candidate.codingType === 0x90)) ?? []).entries()) {
    if (!selectedPid(stream.pid, assetSelection) || pids.has(stream.pid)) continue;
    const key = supStreamKey(clipId, stream.pid, "0");
    byKey.set(key, {
      playlistId: "CLPI",
      playlistNumber: 0,
      playItemIndex: 0,
      clipId,
      pid: stream.pid,
      streamNumber: index + 1,
      language: stream.language ?? "und",
      sourceIn90k: "0",
      sourceOut90k: "0",
      source: `${stream.source.path} @ ${stream.source.offset} (${stream.source.origin})`,
      reachable: false,
    });
    pids.add(stream.pid);
  }

  return [...byKey.values()];
}

export function resolveClipM2tsPath(disc: ParsedDisc, clipId: string): string | undefined {
  const node = disc.graph.nodes.find((candidate) => candidate.id.toUpperCase() === `CLIP:${clipId.toUpperCase()}`);
  const source = node?.state === "present" ? node.source?.path : undefined;
  const relative = source === undefined ? undefined : bdmvRelativePath(source);
  if (!relative || !new RegExp(`^STREAM/${clipId}\\.m2ts$`, "i").test(relative)) return undefined;
  return resolve(disc.root, relative);
}

interface InMemorySupState {
  key: string;
  pid: number;
  timestampOffset90k: bigint;
  effectiveTimestampOffset90k: bigint;
  hasTimestampAnchor: boolean;
  hasDtsAnchor: boolean;
  chunks: Uint8Array[];
  byteLength: number;
}

function appendPesToState(state: InMemorySupState, pes: PesPacket): void {
  if (!state.hasTimestampAnchor) {
    state.hasTimestampAnchor = true;
    const pts = pes.pts?.raw;
    if (pts !== undefined && pes.dtsRaw !== null && pts > state.timestampOffset90k && pts - state.timestampOffset90k <= 180_000n) {
      state.effectiveTimestampOffset90k = pes.dtsRaw;
    }
  }
  let offset = 0;
  while (offset + 3 <= pes.payload.length) {
    const length = (pes.payload[offset + 1]! << 8) | pes.payload[offset + 2]!;
    const end = offset + 3 + length;
    if (end > pes.payload.length) break;
    const pts = Number(((pes.pts?.raw ?? 0n) - state.effectiveTimestampOffset90k) & 0xffff_ffffn);
    const dts = pes.dtsRaw !== null
      ? Number((pes.dtsRaw - state.effectiveTimestampOffset90k) & 0xffff_ffffn)
      : state.hasDtsAnchor ? Number(((pes.pts?.raw ?? 0n) - state.effectiveTimestampOffset90k) & 0xffff_ffffn) : 0;
    if (pes.dtsRaw !== null) state.hasDtsAnchor = true;
    const record = new Uint8Array(13 + length);
    record.set([0x50, 0x47, pts >>> 24, pts >>> 16, pts >>> 8, pts, dts >>> 24, dts >>> 16, dts >>> 8, dts], 0);
    record.set(pes.payload.subarray(offset, end), 10);
    state.chunks.push(record);
    state.byteLength += record.byteLength;
    offset = end;
  }
}

/**
 * Extracts raw SUP byte streams and transport payload byte counts for the requested
 * PIDs from an M2TS file in memory without writing temporary files.
 */
export async function extractSupStreamsFromM2ts(
  clipId: string,
  m2tsPath: string,
  requests: ReadonlyArray<{ pid: number; sourceIn90k: string }>,
  signal?: AbortSignal,
): Promise<{ streams: Map<string, Uint8Array>; payloadBytes: Map<number, number> }> {
  const streams = new Map<string, Uint8Array>();
  const payloadBytes = new Map<number, number>();
  if (!requests.length || signal?.aborted) return { streams, payloadBytes };

  const statesByPid = new Map<number, InMemorySupState[]>();
  for (const request of requests) {
    const key = supStreamKey(clipId, request.pid, request.sourceIn90k);
    const offset90k = BigInt(request.sourceIn90k || "0");
    const state: InMemorySupState = {
      key,
      pid: request.pid,
      timestampOffset90k: offset90k,
      effectiveTimestampOffset90k: offset90k,
      hasTimestampAnchor: false,
      hasDtsAnchor: false,
      chunks: [],
      byteLength: 0,
    };
    const list = statesByPid.get(request.pid) ?? [];
    if (!list.some((item) => item.key === key)) list.push(state);
    statesByPid.set(request.pid, list);
  }

  const pids = new Set(statesByPid.keys());
  const reader = new M2tsPacketReader(clipId);
  const assembler = new PesAssembler(clipId);
  const accept = (pesPackets: PesPacket[]) => {
    for (const pes of pesPackets) {
      for (const state of statesByPid.get(pes.pid) ?? []) appendPesToState(state, pes);
    }
  };

  let remainder = new Uint8Array(0);
  const stream = createReadStream(m2tsPath, { highWaterMark: 1024 * 1024, ...(signal ? { signal } : {}) });
  try {
    for await (const rawChunk of stream) {
      if (signal?.aborted) {
        stream.destroy();
        break;
      }
      const chunk = rawChunk as Uint8Array;
      const buffer = remainder.length ? concatByteChunks([remainder, chunk], remainder.length + chunk.length) : chunk;
      const alignedLength = buffer.length - (buffer.length % 192);
      remainder = alignedLength < buffer.length ? new Uint8Array(Buffer.from(buffer.buffer, buffer.byteOffset + alignedLength, buffer.byteLength - alignedLength)) : new Uint8Array(0);
      if (alignedLength === 0) continue;

      // Fast path: when 192-byte M2TS sync bytes are intact, filter to requested SUP PIDs
      // before constructing TsPacket objects for unrelated video/audio packets.
      let syncIntact = true;
      const matchingOffsets: number[] = [];
      for (let pos = 0; pos < alignedLength; pos += 192) {
        if (buffer[pos + 4] !== 0x47) { syncIntact = false; break; }
        const pid = ((buffer[pos + 5]! & 0x1f) << 8) | buffer[pos + 6]!;
        if (pids.has(pid)) matchingOffsets.push(pos);
      }

      let packets;
      if (syncIntact) {
        if (matchingOffsets.length === 0) continue;
        const filtered = new Uint8Array(matchingOffsets.length * 192);
        for (let i = 0; i < matchingOffsets.length; i++) {
          const start = matchingOffsets[i]!;
          filtered.set(buffer.subarray(start, start + 192), i * 192);
        }
        packets = reader.feed(filtered);
      } else {
        packets = reader.feed(buffer.subarray(0, alignedLength));
      }

      for (const packet of packets) {
        if (!pids.has(packet.pid)) continue;
        payloadBytes.set(packet.pid, (payloadBytes.get(packet.pid) ?? 0) + packet.payload.byteLength);
        accept(assembler.push(packet));
      }
    }
  } catch (error: unknown) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      return { streams, payloadBytes };
    }
    throw error;
  }
  if (remainder.length) {
    for (const packet of reader.feed(remainder)) {
      if (!pids.has(packet.pid)) continue;
      payloadBytes.set(packet.pid, (payloadBytes.get(packet.pid) ?? 0) + packet.payload.byteLength);
      accept(assembler.push(packet));
    }
  }
  reader.end();
  accept(assembler.end());

  for (const list of statesByPid.values()) {
    for (const state of list) {
      if (state.byteLength > 0) {
        streams.set(state.key, concatByteChunks(state.chunks, state.byteLength));
      }
    }
  }
  return { streams, payloadBytes };
}

export interface SupDisplaySetSummary {
  displaySet: PgsDisplaySet;
  displaySetNumber: number;
  startTime90k: number;
  endTime90k: number | null;
  startTimeText: string;
  endTimeText: string;
  boxWidth: number;
  boxHeight: number;
  boxX: number;
  boxY: number;
  visible: boolean;
}

export function summarizeSupDisplaySets(displaySets: readonly PgsDisplaySet[], trackEnd90k?: number): SupDisplaySetSummary[] {
  const summaries: SupDisplaySetSummary[] = [];
  for (let index = 0; index < displaySets.length; index++) {
    const displaySet = displaySets[index]!;
    const endTime90k = pgsDisplaySetEnd90k(displaySets, index, trackEnd90k);
    let minX = displaySet.width;
    let minY = displaySet.height;
    let maxX = 0;
    let maxY = 0;
    let hasPlacement = false;
    for (const placement of displaySet.placements) {
      const bitmap = displaySet.bitmaps.get(placement.objectId);
      if (!bitmap) continue;
      const crop = placement.crop ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
      const left = Math.max(0, placement.x);
      const top = Math.max(0, placement.y);
      const right = Math.min(displaySet.width, placement.x + crop.width);
      const bottom = Math.min(displaySet.height, placement.y + crop.height);
      if (right > left && bottom > top) {
        hasPlacement = true;
        if (left < minX) minX = left;
        if (top < minY) minY = top;
        if (right > maxX) maxX = right;
        if (bottom > maxY) maxY = bottom;
      }
    }
    summaries.push({
      displaySet,
      displaySetNumber: index + 1,
      startTime90k: displaySet.pts90k,
      endTime90k,
      startTimeText: format90kTimestamp(displaySet.pts90k),
      endTimeText: endTime90k !== null ? format90kTimestamp(endTime90k) : "open",
      boxWidth: hasPlacement ? maxX - minX : 0,
      boxHeight: hasPlacement ? maxY - minY : 0,
      boxX: hasPlacement ? minX : 0,
      boxY: hasPlacement ? minY : 0,
      visible: hasPlacement,
    });
  }
  return summaries;
}

export function decodeSupStream(supBytes: Uint8Array, trackEnd90k?: number): { totalDisplaySets: number; visibleSets: SupDisplaySetSummary[]; allSets: SupDisplaySetSummary[] } {
  const parsed = parsePgsSup(supBytes);
  const allSets = summarizeSupDisplaySets(parsed, trackEnd90k);
  const visibleSets = allSets.filter((item) => item.visible);
  return { totalDisplaySets: parsed.length, visibleSets, allSets };
}
