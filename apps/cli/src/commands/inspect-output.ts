import { projectInspectReport, renderInspectReport } from "./inspect-report.js";
import type { InspectionCollection } from "./inspect-collection.js";
import { selectedClip, selectedPid } from "../cli/assets.js";
import { igsMnuPath, pgsTrackEntrySuffixes, supTrackPath } from "../cli/assets.js";

export function projectCombinedInspection(data: InspectionCollection, structureStatus: "complete" | "partial" | "failed") {
  const { disc, graphics } = data;
  const scenes = (graphics?.scenes ?? []).filter((scene) => data.assetType !== "sup" && selectedClip(scene.clipId, data.assetSelection) && selectedPid(scene.pid, data.assetSelection));
  const streams = (graphics?.streams ?? []).filter((stream) => data.assetType !== "sup" && selectedClip(stream.clipId, data.assetSelection) && selectedPid(stream.pid, data.assetSelection));
  const suffixes = pgsTrackEntrySuffixes(data.reachableSup);
  const subtitles = data.reachableSup.map((item, index) => ({ type: "sup", path: supTrackPath(item.clipId, item.pid, index, suffixes[index]), clipId: item.clipId, pid: item.pid, language: item.language, streamNumber: item.streamNumber, playlistId: item.playlistId, playItemIndex: item.playItemIndex }));
  const igsAssets = streams.map((stream) => ({ type: "igs", format: "mnu", path: igsMnuPath(stream.clipId, stream.pid), clipId: stream.clipId, pid: stream.pid, byteLength: stream.byteLength }));
  const imageElements = scenes.flatMap((scene) => scene.objects.map((object) => ({ type: "igs-image-element", clipId: scene.clipId, pid: scene.pid, sceneId: scene.id, compositionNumber: scene.compositionNumber, objectId: object.id, objectVersion: object.version, width: object.width, height: object.height })));
  const subtitleTracksByClip = new Map<string, number>();
  for (const item of subtitles) subtitleTracksByClip.set(item.clipId, (subtitleTracksByClip.get(item.clipId) ?? 0) + 1);
  return {
    schemaVersion: "1.0",
    disc: { ...disc, stageStatus: structureStatus },
    graphics: graphics === null ? null : jsonSafe({
      ...graphics,
      summary: { igsScenes: scenes.length, igsStreams: streams.length, igsImageElements: imageElements.length, supTracks: subtitles.length, m2tsWithSup: subtitleTracksByClip.size, perM2ts: [...subtitleTracksByClip].map(([clipId, subtitleTrackCount]) => ({ clipId, subtitleTrackCount })) },
      assets: [...igsAssets, ...subtitles],
      igsImageElements: imageElements,
      streams: streams.map(({ clipId, pid, byteLength }) => ({ clipId, pid, byteLength })),
      scenes: scenes.map((scene) => ({ ...scene, rawIcs: undefined, objects: scene.objects.map(({ indices: _indices, ...object }) => object) })),
      payloadBytesByClip: Object.fromEntries([...(graphics.payloadBytesByClip ?? new Map<string, Map<number, number>>())].map(([clipId, pids]) => [clipId, Object.fromEntries(pids)])),
    }),
    stageStatus: { structure: structureStatus, graphics: data.graphicsStageStatus },
    fileSizes: data.fileSizes,
    reachableSup: data.reachableSup,
  };
}

export function serializeCombinedInspection(data: InspectionCollection, structureStatus: "complete" | "partial" | "failed"): string {
  return `${JSON.stringify(projectCombinedInspection(data, structureStatus), null, 2)}\n`;
}

export function renderCombinedInspection(data: InspectionCollection, structureStatus: "complete" | "partial" | "failed"): string {
  const lines = [renderInspectReport(projectInspectReport(data.disc), structureStatus).trimEnd(), `Graphics extraction: ${data.graphicsStageStatus}`];
  const streams = (data.graphics?.streams ?? []).filter((stream) => data.assetType !== "sup" && selectedClip(stream.clipId, data.assetSelection) && selectedPid(stream.pid, data.assetSelection));
  const scenes = (data.graphics?.scenes ?? []).filter((scene) => data.assetType !== "sup" && selectedClip(scene.clipId, data.assetSelection) && selectedPid(scene.pid, data.assetSelection));
  lines.push(`Asset summary: ${streams.length} IGS streams · ${scenes.length} IGS scenes · ${scenes.reduce((count, scene) => count + scene.objects.length, 0)} IGS image elements · ${data.reachableSup.length} SUP tracks · ${new Set(data.reachableSup.map((item) => item.clipId)).size} M2TS with SUP`, "Graphics assets by M2TS:");
  const clipIds = [...new Set([...streams.map((item) => item.clipId), ...data.reachableSup.map((item) => item.clipId)])].sort();
  if (!clipIds.length) lines.push(data.graphicsStageStatus === "failed" ? "  unavailable because extraction failed" : "  none");
  for (const clipId of clipIds) {
    const fileBytes = data.fileSizes[clipId];
    const node = data.disc.graph.nodes.find((candidate) => candidate.id === `clip:${clipId}`);
    const sourcePath = node?.state === "present" && node.source?.path && new RegExp(`(?:^|/)STREAM/${clipId}\\.m2ts$`, "i").test(node.source.path) ? node.source.path : "unknown";
    lines.push(`  M2TS ${clipId} · source ${sourcePath} · file size ${fileBytes == null ? "unknown" : `${fileBytes} bytes`}`);
    const payloads = data.graphics?.payloadBytesByClip?.get(clipId);
    for (const stream of streams.filter((item) => item.clipId === clipId)) {
      lines.push(`    IGS PID 0x${stream.pid.toString(16)} · payload ${payloads?.get(stream.pid) ?? "unknown"} bytes`);
      for (const scene of scenes.filter((item) => item.clipId === clipId && item.pid === stream.pid)) {
        lines.push(`      Scene ${scene.id} · composition ${scene.compositionNumber} · ${scene.objects.length} image elements · ${scene.source.path ?? "unknown"} @ ${scene.source.segmentFileOffset ?? "unknown"}`);
        for (const object of scene.objects) lines.push(`        Image element ${object.id} v${object.version} · ${object.width}×${object.height} · ${object.source.path ?? "unknown"} @ ${object.source.segmentFileOffset ?? "unknown"}`);
      }
    }
    for (const item of data.reachableSup.filter((asset) => asset.clipId === clipId)) lines.push(`    SUP PID 0x${item.pid.toString(16)} · ${item.language ?? "unknown"} · Stream ${item.streamNumber} · declared by MPLS ${item.playlistId} / PlayItem ${item.playItemIndex} · payload ${payloads?.get(item.pid) ?? "unknown"} bytes · ${item.source}`);
  }
  if (data.graphics?.diagnostics.length) {
    lines.push("", `Graphics diagnostics (${data.graphics.diagnostics.length}):`);
    for (const diagnostic of data.graphics.diagnostics) {
      const source = diagnostic.source;
      const path = source?.path ?? "unknown";
      const offset = source?.stage === "structural" ? source.sourceOffset : source?.segmentFileOffset;
      lines.push(`  ${diagnostic.severity} ${diagnostic.code} — ${diagnostic.message}`, `    source ${path}${offset == null ? "" : ` @ ${offset}`}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "bigint") return item.toString();
    if (item instanceof Map) return [...item.entries()];
    if (item instanceof Uint8Array) return `<${item.byteLength} bytes>`;
    return item;
  })) as unknown;
}
