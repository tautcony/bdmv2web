import { assetSelection, assetTypeOption, igsMnuPath, pgsTrackEntrySuffixes, selectedClip, selectedPid, supTrackPath, uniquePgsReferences } from "../cli/assets.js";
import { inputPath, optionValue } from "../cli/context.js";
import { fail, outputFormat } from "../cli/errors.js";
import { printTable, writeJsonFile } from "../cli/output.js";
import { firstBlockingCode, stageFailure } from "../cli/stages.js";
import { reachablePgsReferences } from "../shared/pgs.js";
import { assertDisjointRoots } from "@bdmv2web/bdmv-io";
import { parseBdmvWithInputTable } from "@bdmv2web/bdmv-parser";
import { extractIgsScenes } from "@bdmv2web/igs";
import { classifyDiagnostics } from "@bdmv2web/test-runner";
import { bdmvRelativePath } from "@bdmv2web/core/disc-path";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

interface AssetTreeNode { label: string; children?: AssetTreeNode[]; }

function formatAssetTree(nodes: AssetTreeNode[], prefix = ""): string[] {
  return nodes.flatMap((node, index) => {
    const last = index === nodes.length - 1;
    const branch = last ? "└─ " : "├─ ";
    const childPrefix = `${prefix}${last ? "   " : "│  "}`;
    return [`${prefix}${branch}${node.label}`, ...(node.children?.length ? formatAssetTree(node.children, childPrefix) : [])];
  });
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function formatOptionalBytes(bytes: number | undefined): string {
  return bytes === undefined ? "size unavailable" : formatBytes(bytes);
}

export async function listAssets(): Promise<void> {
  const input = inputPath(); if (!input) fail("CLI_MISSING_INPUT", "list requires a BDMV input path");
  const type = assetTypeOption();
  const selection = assetSelection();
  const format = outputFormat("list-assets");
  const out = optionValue("--out");
  const { disc, table } = await parseBdmvWithInputTable(input);
  const fatal = classifyDiagnostics(disc.diagnostics);
  if (fatal.hasFatal) { stageFailure(firstBlockingCode(fatal.blocking), fatal.blocking); return; }
  // The tree view reports per-PID transport payload sizes out of this scan, so
  // each clip is read once. The JSON report carries no sizes and skips measuring.
  const extraction = await extractIgsScenes(disc, {
    renderAssets: false,
    table,
    ...(format === "table" ? { measurePayloadBytes: true } : {}),
    ...(selection.clipId === undefined ? {} : { clipFilter: (clipId: string) => selectedClip(clipId, selection) }),
  });
  const scenes = extraction.scenes.filter((scene) => selectedClip(scene.clipId, selection) && selectedPid(scene.pid, selection));
  const igsStreams = type === "sup" ? [] : extraction.streams.filter((stream) => selectedClip(stream.clipId, selection) && selectedPid(stream.pid, selection)).map((stream) => ({ type: "igs", format: "mnu", path: igsMnuPath(stream.clipId, stream.pid), clipId: stream.clipId, pid: stream.pid, byteLength: stream.byteLength }));
  const igsElements = type === "sup" ? [] : scenes.flatMap((scene) => scene.objects.map((object) => ({ type: "igs-image-element", clipId: scene.clipId, pid: scene.pid, sceneId: scene.id, compositionNumber: scene.compositionNumber, objectId: object.id, objectVersion: object.version, width: object.width, height: object.height })));
  const references = type === "igs" ? [] : uniquePgsReferences(reachablePgsReferences(disc, extraction.scenes)).filter((item) => selectedClip(item.clipId, selection) && selectedPid(item.pid, selection));
  const trackSuffixes = pgsTrackEntrySuffixes(references);
  const subtitles = references.map((item, index) => ({ type: "sup", path: supTrackPath(item.clipId, item.pid, index, trackSuffixes[index]), clipId: item.clipId, pid: item.pid, language: item.language, streamNumber: item.streamNumber, playlistId: item.playlistId, playItemIndex: item.playItemIndex }));
  const subtitleTrackCounts = new Map<string, number>();
  for (const subtitle of subtitles) subtitleTrackCounts.set(subtitle.clipId, (subtitleTrackCounts.get(subtitle.clipId) ?? 0) + 1);
  const perM2ts = [...subtitleTrackCounts].map(([clipId, subtitleTrackCount]) => ({ clipId, subtitleTrackCount }));
  const assets = [...igsStreams, ...subtitles];
  const report = { schemaVersion: "1.0", summary: { igsScenes: type === "sup" ? 0 : scenes.length, igsStreams: igsStreams.length, igsImageElements: igsElements.length, supTracks: subtitles.length, m2tsWithSup: perM2ts.length, perM2ts }, assets, igsImageElements: igsElements };
  if (out) { await assertDisjointRoots(disc.root, resolve(out)); await writeJsonFile(out, `${JSON.stringify(report, null, 2)}\n`); }
  if (format === "json") process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    const clipIds = [...new Set(assets.map((asset) => asset.clipId))].sort((a, b) => a.localeCompare(b, "en"));
    const tree: AssetTreeNode[] = [];
    for (const clipId of clipIds) {
      const clipNode = disc.graph.nodes.find((node) => node.id === `clip:${clipId}`);
      const source = clipNode?.state === "present" ? clipNode.source?.path : undefined;
      const relativeSource = source === undefined ? undefined : bdmvRelativePath(source);
      const hasM2tsSource = relativeSource !== undefined && new RegExp(`^STREAM/${clipId}\\.m2ts$`, "i").test(relativeSource);
      let rawBytes: number | undefined;
      if (hasM2tsSource) {
        try { rawBytes = (await stat(resolve(disc.root, relativeSource))).size; }
        catch { rawBytes = undefined; }
      }
      // Payload sizes come from the extraction scan this run already performed.
      const rawPidSizes: ReadonlyMap<number, number> = extraction.payloadBytesByClip?.get(clipId) ?? new Map<number, number>();
      const children: AssetTreeNode[] = [];
      for (const stream of igsStreams.filter((item) => item.clipId === clipId)) {
        const streamScenes = scenes.filter((scene) => scene.clipId === clipId && scene.pid === stream.pid);
        children.push({
          label: `IGS PID 0x${stream.pid.toString(16)} · payload ${formatOptionalBytes(rawPidSizes.get(stream.pid))}`,
          children: streamScenes.map((scene) => ({ label: `Scene ${scene.id} · composition ${scene.compositionNumber} · ${scene.objects.length} objects` })),
        });
      }
      children.push(...subtitles.filter((item) => item.clipId === clipId).map((asset) => ({
        label: `SUP PID 0x${asset.pid.toString(16)} · ${asset.language} · Stream ${asset.streamNumber} · payload ${formatOptionalBytes(rawPidSizes.get(asset.pid))} · Playlist ${asset.playlistId} / PlayItem ${asset.playItemIndex}`,
      })));
      const size = rawBytes === undefined ? "source unavailable" : formatBytes(rawBytes);
      tree.push({ label: `M2TS ${clipId} · ${size}`, children });
    }
    printTable("Asset summary", ["Type", "Count"], [["IGS streams", report.summary.igsStreams], ["IGS scenes", report.summary.igsScenes], ["IGS image elements", report.summary.igsImageElements], ["SUP tracks", report.summary.supTracks], ["M2TS with SUP", report.summary.m2tsWithSup]]);
    process.stdout.write(`Assets by M2TS\n${formatAssetTree(tree).join("\n")}\n`);
  }
}
