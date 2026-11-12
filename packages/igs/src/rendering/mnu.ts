import { DEFAULT_LIMITS } from "@bdmv2web/core";
import { readU16BE as readU16, readU32BE as readU32 } from "@bdmv2web/utils";
import type { IgsDiagnostic, IgsExtraction, IgsOptions, PtsValue } from "../scene/types.js";
import { consumeSegment, createIgsState, type IgsSegment } from "../scene/igs.js";
import { renderIgsAssets, validateIgsSceneAssets } from "./png.js";

export interface IgsMnuOptions extends IgsOptions {
  /** Identifier used in scene IDs and rendered asset names. */
  clipId?: string;
  /** Pseudo PID used in scene and asset metadata. */
  pid?: number;
}

/**
 * Parse an igstools-compatible MNU stream. Each segment carries `IG` + PTS + DTS;
 * streams also accept the legacy header-per-PES form emitted by earlier exports.
 */
export function parseIgsMnu(data: Uint8Array, options: IgsMnuOptions = {}): IgsExtraction {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const clipId = options.clipId ?? "mnu";
  const pid = options.pid ?? 0x120;
  if (!Number.isInteger(pid) || pid < 0 || pid > 0x1fff) throw new RangeError("MNU PID must be a valid 13-bit transport PID.");
  if (data.length === 0) throw new TypeError("MNU stream is empty.");
  const state = createIgsState();
  const diagnostics: IgsDiagnostic[] = [];
  let offset = 0;
  let previousRaw: number | undefined;
  let epoch = 0n;
  let pts: PtsValue | null = null;
  let packetOffset = 0n;
  while (offset < data.length) {
    let segmentType: number;
    let segmentLength: number;
    let payloadOffset: number;
    if (data[offset] === 0x49 && data[offset + 1] === 0x47) {
      if (offset + 13 > data.length) throw new TypeError(`Truncated MNU segment header at byte ${offset}.`);
      const raw = readU32(data, offset + 2);
      if (previousRaw !== undefined && previousRaw - raw > 0x8000_0000) epoch += 0x1_0000_0000n;
      previousRaw = raw;
      pts = { raw: BigInt(raw), epoch, normalized: epoch + BigInt(raw), timeDomain: 0 };
      packetOffset = BigInt(offset);
      segmentType = data[offset + 10]!;
      segmentLength = readU16(data, offset + 11);
      payloadOffset = offset + 13;
    } else {
      if (pts === null) throw new TypeError("MNU stream must start with an IG segment header.");
      if (offset + 3 > data.length) throw new TypeError(`Truncated MNU segment at byte ${offset}.`);
      segmentType = data[offset]!;
      segmentLength = readU16(data, offset + 1);
      payloadOffset = offset + 3;
    }
    const end = payloadOffset + segmentLength;
    if (end > data.length) throw new TypeError(`Truncated MNU segment payload at byte ${offset}.`);
    const segment: IgsSegment = { type: segmentType, data: data.subarray(payloadOffset, end), offset: BigInt(payloadOffset) };
    consumeSegment(state, segment, clipId, pid, pts, packetOffset, packetOffset, BigInt(payloadOffset), limits);
    offset = end;
  }
  for (const pending of state.pendingObjects.values()) {
    diagnostics.push({ severity: "error", code: "IGS_INVALID_SEGMENT", message: `MNU ended with incomplete ODS object ${pending.id} version ${pending.version}`, source: pending.source, affectedSceneIds: [] });
  }
  for (const current of state.current.values()) {
    diagnostics.push({ severity: "error", code: "IGS_UNCOMPLETED_DISPLAY_SET", message: "MNU ended before END segment; Display Set was not committed", source: current.source, affectedSceneIds: [] });
  }
  diagnostics.push(...state.diagnostics);
  const scenes = state.scenes;
  const assets: IgsExtraction["assets"] = [];
  if (options.renderAssets !== false) {
    const rendered = renderIgsAssets(scenes, { level: options.pngLevel });
    assets.push(...rendered.assets);
    diagnostics.push(...rendered.diagnostics);
  } else diagnostics.push(...validateIgsSceneAssets(scenes));
  const errors = diagnostics.some((item) => item.severity === "error");
  const warnings = diagnostics.some((item) => item.severity === "warning");
  if (!scenes.length && !diagnostics.length) diagnostics.push({ severity: "warning", code: "IGS_NO_DISPLAY_SETS", message: "No complete IGS Display Set was found", source: null, affectedSceneIds: [], stage: "igs" });
  return {
    scenes,
    assets,
    streams: [],
    diagnostics,
    status: errors ? (scenes.length ? "partial" : "failed") : (warnings || !scenes.length ? "partial" : "complete"),
    support: { format: "Blu-ray IGS", status: "unverified" },
  };
}
