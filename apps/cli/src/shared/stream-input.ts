import { ContractError, DEFAULT_LIMITS, type Limits } from "@bdmv2web/core";
import { readFileChunks } from "@bdmv2web/bdmv-io";
import { probeTransportStreams } from "@bdmv2web/igs";
import type { IgsDiagnostic } from "@bdmv2web/igs";
import { safeAssetStem } from "../cli/assets.js";
import { open, lstat } from "node:fs/promises";
import { extname } from "node:path";

const STREAM_EXTENSIONS = new Set([".m2ts", ".rsks"]);
/**
 * Enough bytes to see a sync byte near the start and the next packet boundary:
 * plain transport streams start at 0 with a 188-byte stride, BDAV `.m2ts`/`.rsks`
 * starts at 4 with a 192-byte stride (4-byte TP_extra_header per packet).
 */
const SNIFF_BYTES = 200;

export interface StreamTarget { path: string; stem: string }

/**
 * What a positional input is. `mnu` and `sup` are the container formats `export`
 * writes, so `render` is the only command that consumes them.
 */
export type GraphicsInput =
  | { kind: "bdmv" }
  | ({ kind: "stream" } & StreamTarget)
  | ({ kind: "mnu" } & StreamTarget)
  | ({ kind: "sup" } & StreamTarget);

/**
 * Classify one input by content first and extension second, so a renamed file
 * still reads as what it is: a transport stream starts with 0x47 at both packet
 * boundaries, an IGS container with an `ICS`/`PDS`/`ODS` segment tag, a PGS
 * stream with a `PG` segment. Anything else keeps the BDMV input path and its
 * existing error behavior, so a mistyped disc root still fails as a disc.
 */
export async function classifyInput(input: string): Promise<GraphicsInput> {
  const stats = await lstat(input);
  if (!stats.isFile()) return { kind: "bdmv" };
  const kind = await sniffKind(input) ?? extensionKind(input);
  if (kind === null) return { kind: "bdmv" };
  return { kind, path: input, stem: safeAssetStem(input) };
}

async function sniffKind(path: string): Promise<"stream" | "mnu" | "sup" | null> {
  const handle = await open(path, "r");
  let bytes: Buffer;
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
    bytes = buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
  if (bytes.length === 0) return null;
  const tag = bytes.subarray(0, 3).toString("latin1");
  if (tag === "ICS" || tag === "PDS" || tag === "ODS") return "mnu";
  if (bytes[0] === 0x50 && bytes[1] === 0x47) return "sup";
  // The next packet confirms the framing instead of trusting one 0x47 byte.
  for (const offset of [0, 4]) {
    if (bytes[offset] !== 0x47) continue;
    if (bytes.length <= offset + 188 || bytes[offset + 188] === 0x47 || bytes[offset + 192] === 0x47) return "stream";
  }
  return null;
}

function extensionKind(path: string): "stream" | "mnu" | "sup" | null {
  const extension = extname(path).toLocaleLowerCase("en-US");
  if (STREAM_EXTENSIONS.has(extension)) return "stream";
  if (extension === ".mnu") return "mnu";
  if (extension === ".sup") return "sup";
  return null;
}

export interface GraphicsStreams {
  /** PMT-declared PGS (stream_type 0x90) PIDs in declaration order. */
  readonly pgsPids: number[];
  /** PMT-declared IGS (stream_type 0x91) PIDs in declaration order. */
  readonly igsPids: number[];
  readonly diagnostics: IgsDiagnostic[];
}

/** Probe one stream file for its declared PGS/IGS PIDs, ignoring reserved PIDs. */
export async function discoverGraphicsStreams(path: string, limits: Limits = DEFAULT_LIMITS): Promise<GraphicsStreams> {
  const stem = safeAssetStem(path);
  const probe = await probeTransportStreams(stem, readFileChunks(path, limits, limits.maxReadWindowBytes), { limits });
  if (!probe.hasProgramTables) {
    throw new ContractError("EXPORT_INVALID_STREAM", path, "Input carries no PAT/PMT program tables and cannot be read as an m2ts transport stream.");
  }
  const pgsPids: number[] = [];
  const igsPids: number[] = [];
  for (const [pid, streamType] of probe.streamsByPid) {
    if (pid < 0x20) continue;
    if (streamType === 0x90) pgsPids.push(pid);
    else if (streamType === 0x91) igsPids.push(pid);
  }
  return { pgsPids, igsPids, diagnostics: probe.diagnostics };
}
