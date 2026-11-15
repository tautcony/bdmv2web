import { M2tsPacketReader, PsiAssembler } from "@bdmv2web/igs";
import type { IgsDiagnostic, TsPacket } from "@bdmv2web/igs";
import type { Limits } from "@bdmv2web/core";
import { fanOutWithDone } from "./chunk-fanout.js";

export interface SharedPacketScan {
  /** One batch stream per consumer; all carry the same packet objects, whose
   * payloads are views on the reader's private, immutable chunk buffers. */
  readonly batches: AsyncIterable<readonly TsPacket[]>[];
  /** Resolves when the producer has read to EOF; diagnostics are complete then. */
  readonly done: Promise<void>;
  /** PSI section diagnostics from the whole clip. */
  readonly psiDiagnostics: readonly IgsDiagnostic[];
  /** Transport diagnostics from the whole clip, including trailing bytes. */
  readonly transportDiagnostics: readonly IgsDiagnostic[];
}

/**
 * Parse a clip once and publish its transport packets to every consumer.
 *
 * One `M2tsPacketReader` and one `PsiAssembler` own the scan, so transport and
 * PSI diagnostics are produced once for the whole input, including the tail
 * after a consumer stops early. Consumers keep their own PES and display-set
 * state and can stop independently; the producer reads to EOF regardless.
 */
export function fanOutPackets(chunks: AsyncIterable<Uint8Array>, clipId: string, consumers: number, limits: Limits): SharedPacketScan {
  const reader = new M2tsPacketReader(clipId, limits);
  const psiDiagnostics: IgsDiagnostic[] = [];
  const psi = new PsiAssembler(psiDiagnostics, clipId);
  async function* batches(): AsyncGenerator<readonly TsPacket[]> {
    let completed = false;
    try {
      for await (const chunk of chunks) {
        const packets = reader.feed(chunk);
        for (const packet of packets) psi.push(packet);
        yield packets;
      }
      completed = true;
    } finally {
      // A scan cut short by every consumer stopping has no EOF to report.
      if (completed) reader.end();
    }
  }
  const { streams, done } = fanOutWithDone(batches(), consumers, { readToEnd: true });
  return { batches: streams, done, psiDiagnostics, transportDiagnostics: reader.diagnostics };
}
