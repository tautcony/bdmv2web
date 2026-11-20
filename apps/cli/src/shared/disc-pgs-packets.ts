import { DEFAULT_LIMITS } from "@bdmv2web/core";
import type { IgsClipPacketScan, IgsDiagnostic, TsPacket } from "@bdmv2web/igs";

interface RetainedPackets {
  pids: ReadonlySet<number>;
  batches: TsPacket[][];
  bytes: number;
}

type ClipPids = ReadonlySet<number> | undefined;

/** Retain selected PGS packets until IGS navigation determines which tracks to open. */
export class DiscPgsPacketCache {
  private readonly clips = new Map<string, RetainedPackets>();
  private bytes = 0;

  constructor(private readonly pidsForClip: (clipId: string, path: string) => ClipPids | Promise<ClipPids>) {}

  readonly scan: IgsClipPacketScan = (clipId, path, batches, diagnostics) => this.retain(clipId, path, batches, diagnostics);

  private async *retain(clipId: string, path: string, batches: AsyncIterable<readonly TsPacket[]>, diagnostics: readonly IgsDiagnostic[]): AsyncGenerator<readonly TsPacket[]> {
    const pids = await this.pidsForClip(clipId, path);
    if (!pids?.size) { yield* batches; return; }
    const buffers = new Set<ArrayBufferLike>();
    let retained: RetainedPackets | undefined = { pids, batches: [], bytes: 0 };
    for await (const batch of batches) {
      if (retained) {
        const selected = batch.filter((packet) => pids.has(packet.pid));
        // Payloads are views owned by the scan. Charge their backing buffers and packet metadata.
        retained.bytes += selected.length * 128;
        for (const { payload } of selected) {
          if (buffers.has(payload.buffer)) continue;
          buffers.add(payload.buffer);
          retained.bytes += payload.buffer.byteLength;
        }
        if (this.bytes + retained.bytes > DEFAULT_LIMITS.maxReassemblyBytes) {
          buffers.clear();
          retained = undefined;
        } else if (selected.length) retained.batches.push(selected);
      }
      yield batch;
    }
    // Reuse complete scans with error-free transport. Interrupted or damaged scans
    // use the command's direct PGS reader and its diagnostic policy.
    if (retained && !diagnostics.some((item) => item.severity === "error")) {
      this.clips.set(path, retained);
      this.bytes += retained.bytes;
    }
  }

  take(path: string, requests: readonly { pid: number }[]): readonly (readonly TsPacket[])[] | undefined {
    const retained = this.clips.get(path);
    if (!retained) return undefined;
    this.clips.delete(path);
    this.bytes -= retained.bytes;
    return requests.every(({ pid }) => retained.pids.has(pid)) ? retained.batches : undefined;
  }
}
