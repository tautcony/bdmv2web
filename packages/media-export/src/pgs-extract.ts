import { mkdir, unlink, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { M2tsPacketReader, PesAssembler } from "@bdmv2web/igs";
import { parsePgsSup } from "./pgs.js";

export interface ExtractedPgsTrack { pid: number; sourcePath: string; path: string; byteLength: number; displaySets: ReturnType<typeof parsePgsSup>; }

/** Extract one declared Blu-ray PGS PID as SUP, then parse and validate every display set. */
export async function extractPgsTrack(sourcePath: string, pid: number, outputPath: string, options: { maxBytes?: number; timestampOffset90k?: bigint } = {}): Promise<ExtractedPgsTrack> {
  if (!Number.isSafeInteger(pid) || pid < 0x20 || pid > 0x1ffe) throw new RangeError("PGS PID must be a valid 13-bit transport PID.");
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError("maxBytes must be a positive safe integer.");
  const timestampOffset90k = options.timestampOffset90k ?? 0n;
  if (timestampOffset90k < 0n) throw new RangeError("timestampOffset90k must be non-negative.");
  const output = resolve(outputPath);
  await mkdir(resolve(output, ".."), { recursive: true });
  try {
    const reader = new M2tsPacketReader("pgs-extraction");
    const assembler = new PesAssembler("pgs-extraction");
    const segments: Uint8Array[] = [];
    let byteLength = 0;
    let effectiveTimestampOffset90k = timestampOffset90k;
    let hasTimestampAnchor = false;
    let hasDtsAnchor = false;
    const accept = (pesPackets: ReturnType<PesAssembler["push"]>) => {
      for (const pes of pesPackets) {
        if (!hasTimestampAnchor) {
          hasTimestampAnchor = true;
          const pts = pes.pts?.raw;
          // The reference SUP timestamp convention anchors a PGS stream near
          // the source interval to its first DTS, then keeps all later deltas.
          if (pts !== undefined && pes.dtsRaw !== null && pts > timestampOffset90k && pts - timestampOffset90k <= 180_000n) effectiveTimestampOffset90k = pes.dtsRaw;
        }
        let offset = 0;
        while (offset < pes.payload.length) {
          if (offset + 3 > pes.payload.length) throw new TypeError(`PGS PID ${pid} contains a truncated PES segment header.`);
          const length = (pes.payload[offset + 1]! << 8) | pes.payload[offset + 2]!;
          const end = offset + 3 + length;
          if (end > pes.payload.length) throw new TypeError(`PGS PID ${pid} contains a truncated PES segment payload.`);
          const pts = Number(((pes.pts?.raw ?? 0n) - effectiveTimestampOffset90k) & 0xffff_ffffn);
          const dts = pes.dtsRaw !== null
            ? Number((pes.dtsRaw - effectiveTimestampOffset90k) & 0xffff_ffffn)
            : hasDtsAnchor ? Number(((pes.pts?.raw ?? 0n) - effectiveTimestampOffset90k) & 0xffff_ffffn) : 0;
          if (pes.dtsRaw !== null) hasDtsAnchor = true;
          const record = new Uint8Array(13 + length);
          record.set([0x50, 0x47, pts >>> 24, pts >>> 16, pts >>> 8, pts, dts >>> 24, dts >>> 16, dts >>> 8, dts], 0);
          record.set(pes.payload.subarray(offset, end), 10);
          segments.push(record); byteLength += record.byteLength;
          if (byteLength > maxBytes) throw new RangeError(`Extracted PGS PID ${pid} exceeds maxBytes.`);
          offset = end;
        }
      }
    };
    for await (const chunk of createReadStream(resolve(sourcePath), { highWaterMark: 256 * 1024 }) as AsyncIterable<Uint8Array>) {
      for (const packet of reader.feed(chunk)) if (packet.pid === pid) accept(assembler.push(packet));
    }
    reader.end();
    accept(assembler.end());
    const transportError = reader.diagnostics.find((item) => item.source?.pid === pid && item.severity === "error");
    const pesError = assembler.diagnostics.find((item) => item.source?.pid === pid && item.severity === "error");
    if (transportError) throw new TypeError(`PGS PID ${pid} transport stream is invalid: ${transportError.message}`);
    if (pesError) throw new TypeError(`PGS PID ${pid} PES stream is invalid: ${pesError.message}`);
    const bytes = concatBytes(segments, byteLength);
    const displaySets = parsePgsSup(bytes);
    if (displaySets.length === 0) throw new TypeError(`Extracted PGS PID ${pid} contains no complete display sets.`);
    await writeFile(output, bytes);
    return { pid, sourcePath: resolve(sourcePath), path: output, byteLength: bytes.byteLength, displaySets };
  } catch (error) {
    await unlink(output).catch(() => undefined);
    throw error;
  }
}

function concatBytes(chunks: readonly Uint8Array[], byteLength: number): Uint8Array {
  const output = new Uint8Array(byteLength); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}
