import { ContractError, DEFAULT_LIMITS, type Limits } from "@bdmv2web/core";
import { readFileChunks } from "@bdmv2web/bdmv-io";
import { probeTransportStreams } from "@bdmv2web/igs";
import type { IgsDiagnostic } from "@bdmv2web/igs";
import { safeAssetStem } from "../cli/assets.js";
import { lstat } from "node:fs/promises";
import { extname } from "node:path";

const STREAM_EXTENSIONS = new Set([".m2ts", ".rsks"]);

export interface StreamTarget { path: string; stem: string }

export type StreamInput =
  | ({ kind: "stream" } & StreamTarget)
  | { kind: "bdmv" };

/**
 * A regular file with a stream extension is read directly from its bytes;
 * everything else keeps the BDMV input path, including its error behavior.
 * `export` and `render` share this classification so both accept the same inputs.
 */
export async function classifyStreamInput(input: string): Promise<StreamInput> {
  const stats = await lstat(input);
  if (!stats.isFile() || !STREAM_EXTENSIONS.has(extname(input).toLocaleLowerCase("en-US"))) return { kind: "bdmv" };
  return { kind: "stream", path: input, stem: safeAssetStem(input) };
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
