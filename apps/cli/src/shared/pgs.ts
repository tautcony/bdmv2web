import { buildMediaClosure } from "./media.js";
import { resolveInputFile } from "@bdmv2web/bdmv-io";
import { extractIgsScenes } from "@bdmv2web/igs";
import { extractPgsTrack } from "@bdmv2web/media-export";
import { resolve } from "node:path";
import type { ParsedDisc } from "@bdmv2web/bdmv-parser";

export async function extractReachablePgsTracks(disc: ParsedDisc, scenes: Awaited<ReturnType<typeof extractIgsScenes>>["scenes"], outputDirectory: string, pathForReference?: (reference: ReturnType<typeof reachablePgsReferences>[number], index: number) => string, selectedReferences?: ReturnType<typeof reachablePgsReferences>) {
  const references = selectedReferences ?? reachablePgsReferences(disc, scenes);
  const extracted = new Map<string, Awaited<ReturnType<typeof extractPgsTrack>> & { packagePath: string }>();
  const result = [];
  for (const [index, reference] of references.entries()) {
    const key = trackIdentityBySourceIn(reference);
    let track = extracted.get(key);
    if (!track) {
      const sourcePath = await resolveInputFile(disc.root, `STREAM/${reference.clipId}.m2ts`);
      const relativePath = pathForReference?.(reference, index) ?? `assets/subtitles/${reference.clipId}-${reference.pid.toString(16)}.sup`;
      track = { ...await extractPgsTrack(sourcePath, reference.pid, resolve(outputDirectory, relativePath), { timestampOffset90k: BigInt(reference.sourceIn90k) }), packagePath: relativePath };
      extracted.set(key, track);
    }
    result.push({ ...reference, path: track.packagePath, displaySets: track.displaySets });
  }
  return result;
}

function trackIdentityBySourceIn(reference: { clipId: string; pid: number; sourceIn90k: string }): string {
  return `${reference.clipId.toLocaleLowerCase("en-US")}:${reference.pid}:${reference.sourceIn90k}`;
}

export function reachablePgsReferences(disc: ParsedDisc, scenes: Awaited<ReturnType<typeof extractIgsScenes>>["scenes"]) {
  const closure = buildMediaClosure(disc, scenes);
  return closure.playlistIds.flatMap((nodeId) => {
    const playlistId = nodeId.slice("playlist:".length);
    const playlist = disc.playlists.find((item) => item.id.toLocaleLowerCase("en-US") === playlistId.toLocaleLowerCase("en-US"));
    return playlist?.playItems.flatMap((item) => item.streams.filter((stream) => stream.pid !== null && stream.streamType === 1 && stream.codingType === 0x90)
      .map((stream, index) => ({ playlistId, playlistNumber: Number(playlistId), playItemIndex: item.index, clipId: item.clipId, pid: stream.pid!, streamNumber: index + 1, language: stream.language ?? "und", sourceIn90k: String(item.inTime45k * 2), sourceOut90k: String(item.outTime45k * 2), source: `BDMV/STREAM/${item.clipId}.m2ts` }))) ?? [];
  });
}
