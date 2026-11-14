import { DEFAULT_LIMITS, type Limits } from "@bdmv2web/core";
import type { IgsDiagnostic } from "../scene/types.js";
import { M2tsPacketReader, PsiAssembler } from "./transport.js";

export interface TransportStreamProbe {
  /** Stream declarations of the first received PMT section: PID → stream_type. */
  readonly streamsByPid: Map<number, number>;
  /** True when a complete PAT and at least one PMT section were received. */
  readonly hasProgramTables: boolean;
  /** Transport and PSI diagnostics from the whole input, including trailing garbage. */
  readonly diagnostics: IgsDiagnostic[];
}

/**
 * Read a whole BDAV m2ts byte stream and report the declared elementary streams
 * plus every transport/PSI diagnostic. The first PMT section wins: its stream
 * entries are read directly from the section bytes, so a PMT whose CRC the
 * assembler rejects (community-authored muxes) still yields its declarations
 * while the PSI_CRC_INVALID diagnostic keeps the failure visible. Later
 * transport damage may clear the live assembler state; the first declaration
 * snapshot stays authoritative for callers that only need discovery.
 */
export async function probeTransportStreams(clipId: string, chunks: AsyncIterable<Uint8Array>, options: { limits?: Limits } = {}): Promise<TransportStreamProbe> {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const reader = new M2tsPacketReader(clipId, limits);
  const diagnostics: IgsDiagnostic[] = [];
  const psi = new PsiAssembler(diagnostics, clipId);
  let declared: Map<number, number> | null = null;
  for await (const chunk of chunks) {
    for (const packet of reader.feed(chunk)) {
      for (const section of psi.push(packet)) {
        if (declared === null && section.tableId === 0x02) declared = declaredPmtStreams(section.bytes);
      }
    }
  }
  reader.end();
  return { streamsByPid: declared ?? new Map<number, number>(), hasProgramTables: declared !== null, diagnostics: [...diagnostics, ...reader.diagnostics] };
}

/** Stream entries of one PMT section, bounded by its declared length and CRC field. */
function declaredPmtStreams(section: Uint8Array): Map<number, number> {
  const streams = new Map<number, number>();
  if (section.length < 16) return streams;
  const infoLength = ((section[10]! & 15) << 8) | section[11]!;
  let cursor = 12 + infoLength;
  while (cursor + 5 <= section.length - 4) {
    const streamType = section[cursor]!;
    const pid = ((section[cursor + 1]! & 31) << 8) | section[cursor + 2]!;
    const esLength = ((section[cursor + 3]! & 15) << 8) | section[cursor + 4]!;
    if (cursor + 5 + esLength > section.length - 4) break;
    streams.set(pid, streamType);
    cursor += 5 + esLength;
  }
  return streams;
}
