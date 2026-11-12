import { buildMediaClosure } from "./media.js";
import { resolveInputFile } from "@bdmv2web/bdmv-io";
import { extractIgsScenes } from "@bdmv2web/igs";
import { extractPgsTracks } from "@bdmv2web/media-export";
import { resolve } from "node:path";
import type { ParsedDisc } from "@bdmv2web/bdmv-parser";
import { equalsIgnoreCase } from "@bdmv2web/utils";

export async function extractReachablePgsTracks(disc: ParsedDisc, scenes: Awaited<ReturnType<typeof extractIgsScenes>>["scenes"], outputDirectory: string, pathForReference?: (reference: ReturnType<typeof reachablePgsReferences>[number], index: number) => string, selectedReferences?: ReturnType<typeof reachablePgsReferences>) {
  const references = selectedReferences ?? reachablePgsReferences(disc, scenes);
  const extracted = new Map<string, { packagePath: string; displaySets: Awaited<ReturnType<typeof extractPgsTracks>>[number]["displaySets"] }>();
  const byClip = new Map<string, Array<{ key: string; relativePath: string; reference: typeof references[number] }>>();
  const scheduled = new Set<string>();
  for (const [index, reference] of references.entries()) {
    const key = trackIdentityBySourceIn(reference);
    if (scheduled.has(key)) continue;
    scheduled.add(key);
    const tracks = byClip.get(reference.clipId.toLocaleLowerCase("en-US")) ?? [];
    tracks.push({ key, reference, relativePath: pathForReference?.(reference, index) ?? `assets/subtitles/${reference.clipId}-${reference.pid.toString(16)}.sup` });
    byClip.set(reference.clipId.toLocaleLowerCase("en-US"), tracks);
  }
  for (const tracks of byClip.values()) {
    const sourcePath = await resolveInputFile(disc.root, `STREAM/${tracks[0]!.reference.clipId}.m2ts`);
    const outputs = await extractPgsTracks(sourcePath, tracks.map(({ reference, relativePath }) => ({ pid: reference.pid, outputPath: resolve(outputDirectory, relativePath), timestampOffset90k: BigInt(reference.sourceIn90k) })));
    for (const [index, track] of outputs.entries()) extracted.set(tracks[index]!.key, { packagePath: tracks[index]!.relativePath, displaySets: track.displaySets });
  }
  return references.map((reference) => {
    const track = extracted.get(trackIdentityBySourceIn(reference))!;
    return { ...reference, path: track.packagePath, displaySets: track.displaySets };
  });
}

export function trackIdentityBySourceIn(reference: { clipId: string; pid: number; sourceIn90k: string }): string {
  return `${reference.clipId.toLocaleLowerCase("en-US")}:${reference.pid}:${reference.sourceIn90k}`;
}

export function reachablePgsReferences(disc: ParsedDisc, scenes: Awaited<ReturnType<typeof extractIgsScenes>>["scenes"]) {
  const closure = buildMediaClosure(disc, scenes);
  return closure.playlistIds.flatMap((nodeId) => {
    const playlistId = nodeId.slice("playlist:".length);
    const playlist = disc.playlists.find((item) => equalsIgnoreCase(item.id, playlistId));
    return playlist?.playItems.flatMap((item) => item.streams.filter((stream) => stream.pid !== null && stream.streamType === 1 && stream.codingType === 0x90)
      .map((stream, index) => ({ playlistId, playlistNumber: Number(playlistId), playItemIndex: item.index, clipId: item.clipId, pid: stream.pid!, streamNumber: index + 1, language: stream.language ?? "und", sourceIn90k: String(item.inTime45k * 2), sourceOut90k: String(item.outTime45k * 2), source: `BDMV/STREAM/${item.clipId}.m2ts` }))) ?? [];
  });
}
