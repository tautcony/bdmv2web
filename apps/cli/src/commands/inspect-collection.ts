import { extractIgsScenes } from "@bdmv2web/igs";
import { parseBdmvWithInputTable, type ParsedDisc } from "@bdmv2web/bdmv-parser";
import { classifyDiagnostics } from "@bdmv2web/test-runner";
import { reachablePgsReferences } from "../shared/pgs.js";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { bdmvRelativePath } from "@bdmv2web/core/disc-path";
import { selectedClip, selectedPid, uniquePgsReferences, type AssetSelection, type AssetType } from "../cli/assets.js";
import { collectDeclaredSupForClip, extractSupStreamsFromM2ts, resolveClipM2tsPath } from "./inspect-sup.js";

export interface InspectionCollection {
  disc: ParsedDisc;
  graphics: Awaited<ReturnType<typeof extractIgsScenes>> | null;
  graphicsStageStatus: "complete" | "partial" | "failed" | "not-run" | "loading";
  fileSizes: Record<string, number | null>;
  reachableSup: ReturnType<typeof reachablePgsReferences>;
  assetSelection: AssetSelection;
  assetType: AssetType;
  supStreams?: Map<string, Uint8Array>;
  loadingClips?: Set<string>;
}

export async function collectStructuralInspection(
  input: string,
  assetSelection: AssetSelection,
  assetType: AssetType,
): Promise<InspectionCollection> {
  const { disc } = await parseBdmvWithInputTable(input);
  const structural = classifyDiagnostics(disc.diagnostics);
  const fileSizes: Record<string, number | null> = {};
  const clipIds = new Set(structural.hasFatal ? [] : [
    ...disc.playlists.flatMap((playlist) => playlist.playItems.map((item) => item.clipId)),
    ...disc.playlists.flatMap((playlist) => playlist.subPaths.flatMap((subPath) => subPath.items.map((item) => item.clipId))),
    ...disc.playlists.flatMap((playlist) => playlist.playItems.filter((item) => item.streams.some((s) => s.codingType === 0x90 || s.codingType === 0x91)).map((item) => item.clipId)),
    ...disc.clips.filter((clip) => clip.programs.some((p) => p.streams.some((s) => s.codingType === 0x90 || s.codingType === 0x91))).map((clip) => clip.id),
  ]);
  const loadingClips = new Set<string>();
  for (const clipId of [...clipIds].sort()) {
    loadingClips.add(clipId);
    const node = disc.graph.nodes.find((candidate) => candidate.id === `clip:${clipId}`);
    const source = node?.state === "present" ? node.source?.path : undefined;
    const relative = source === undefined ? undefined : bdmvRelativePath(source);
    if (!relative || !new RegExp(`^STREAM/${clipId}\\.m2ts$`, "i").test(relative)) { fileSizes[clipId] = null; continue; }
    try { fileSizes[clipId] = (await stat(resolve(disc.root, relative))).size; }
    catch { fileSizes[clipId] = null; }
  }
  const reachable = reachablePgsReferences(disc, []);
  const reachableSup = assetType !== "igs" ? uniquePgsReferences(reachable).filter((item) => selectedClip(item.clipId, assetSelection) && selectedPid(item.pid, assetSelection)) : [];
  const graphicsStageStatus = structural.hasFatal ? "not-run" : "loading";
  const graphics = structural.hasFatal ? null : {
    scenes: [],
    assets: [],
    streams: [],
    diagnostics: [],
    status: "complete" as const,
    support: { format: "Blu-ray IGS" as const, status: "unverified" as const },
    payloadBytesByClip: new Map<string, ReadonlyMap<number, number>>(),
  };
  return {
    disc,
    graphics,
    graphicsStageStatus,
    fileSizes,
    reachableSup,
    assetSelection,
    assetType,
    supStreams: new Map(),
    loadingClips,
  };
}

/** Collects the inspect/list data once. All later views must use this in-memory snapshot. */
export async function collectInspection(input: string, assetSelection: AssetSelection, assetType: AssetType, onPhase?: (phase: "structure" | "graphics") => void): Promise<InspectionCollection> {
  onPhase?.("structure");
  const { disc, table } = await parseBdmvWithInputTable(input);
  const structural = classifyDiagnostics(disc.diagnostics);
  onPhase?.("graphics");
  const extraction = structural.hasFatal ? null : await extractIgsScenes(disc, {
    renderAssets: false, measurePayloadBytes: true, table,
    ...(assetSelection.clipId === undefined ? {} : { clipFilter: (clipId: string) => selectedClip(clipId, assetSelection) }),
  });
  const reachable = extraction ? reachablePgsReferences(disc, extraction.scenes) : [];
  const graphics = extraction;
  const reachableSup = assetType !== "igs" ? uniquePgsReferences(reachable).filter((item) => selectedClip(item.clipId, assetSelection) && selectedPid(item.pid, assetSelection)) : [];
  const fileSizes: Record<string, number | null> = {};
  // These are already-declared PlayItem targets, not an expanded STREAM scan.
  const clipIds = new Set(structural.hasFatal ? [] : [
    ...disc.playlists.flatMap((playlist) => playlist.playItems.map((item) => item.clipId)),
    ...disc.playlists.flatMap((playlist) => playlist.subPaths.flatMap((subPath) => subPath.items.map((item) => item.clipId))),
    ...disc.playlists.flatMap((playlist) => playlist.playItems.filter((item) => item.streams.some((s) => s.codingType === 0x90)).map((item) => item.clipId)),
    ...disc.clips.filter((clip) => clip.programs.some((p) => p.streams.some((s) => s.codingType === 0x90))).map((clip) => clip.id),
    ...(graphics?.streams.map((item) => item.clipId) ?? []),
    ...reachableSup.map((item) => item.clipId),
  ]);
  for (const clipId of [...clipIds].sort()) {
    const node = disc.graph.nodes.find((candidate) => candidate.id === `clip:${clipId}`);
    const source = node?.state === "present" ? node.source?.path : undefined;
    const relative = source === undefined ? undefined : bdmvRelativePath(source);
    if (!relative || !new RegExp(`^STREAM/${clipId}\\.m2ts$`, "i").test(relative)) { fileSizes[clipId] = null; continue; }
    try { fileSizes[clipId] = (await stat(resolve(disc.root, relative))).size; }
    catch { fileSizes[clipId] = null; }
  }

  const supStreams = new Map<string, Uint8Array>();
  if (assetType !== "igs") {
    for (const clipId of [...clipIds].sort()) {
      const supDecls = collectDeclaredSupForClip(disc, reachableSup, clipId, assetSelection, assetType);
      const fileBytes = fileSizes[clipId] ?? null;
      if (supDecls.length > 0 && fileBytes !== null && fileBytes > 0 && (fileBytes <= 64 * 1024 * 1024 || assetSelection.clipId !== undefined)) {
        const m2tsPath = resolveClipM2tsPath(disc, clipId);
        if (m2tsPath) {
          try {
            const extracted = await extractSupStreamsFromM2ts(clipId, m2tsPath, supDecls);
            for (const [k, v] of extracted.streams) supStreams.set(k, v);
            if (extracted.payloadBytes.size > 0 && graphics?.payloadBytesByClip instanceof Map) {
              const existing = graphics.payloadBytesByClip.get(clipId) as ReadonlyMap<number, number> | undefined;
              const merged = new Map<number, number>(existing);
              for (const [pid, bytes] of extracted.payloadBytes) {
                if (!merged.has(pid)) merged.set(pid, bytes);
              }
              graphics.payloadBytesByClip.set(clipId, merged);
            }
          } catch {
            // ignore extraction errors
          }
        }
      }
    }
  }

  const graphicsStageStatus = graphics?.status ?? "not-run";
  return { disc, graphics, graphicsStageStatus, fileSizes, reachableSup, assetSelection, assetType, supStreams };
}
