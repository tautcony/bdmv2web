import { extractIgsScenes } from "@bdmv2web/igs";
import { parseBdmvWithInputTable, type ParsedDisc } from "@bdmv2web/bdmv-parser";
import { classifyDiagnostics } from "@bdmv2web/test-runner";
import { reachablePgsReferences } from "../shared/pgs.js";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { bdmvRelativePath } from "@bdmv2web/core/disc-path";
import { selectedClip, selectedPid, uniquePgsReferences, type AssetSelection, type AssetType } from "../cli/assets.js";

export interface InspectionCollection {
  disc: ParsedDisc;
  graphics: Awaited<ReturnType<typeof extractIgsScenes>> | null;
  graphicsStageStatus: "complete" | "partial" | "failed" | "not-run";
  fileSizes: Record<string, number | null>;
  reachableSup: ReturnType<typeof reachablePgsReferences>;
  assetSelection: AssetSelection;
  assetType: AssetType;
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
  const graphicsStageStatus = graphics?.status ?? "not-run";
  return { disc, graphics, graphicsStageStatus, fileSizes, reachableSup, assetSelection, assetType };
}
