import { reachableMediaPlaylists } from "./media.js";
import { mapWithConcurrency } from "./concurrency.js";
import { countOf } from "../progress.js";
import type { ProgressReporter } from "../progress.js";
import type { AssetRecord } from "../cli/assets.js";
import { resolveInputFile } from "@bdmv2web/bdmv-io";
import { extractIgsScenes } from "@bdmv2web/igs";
import { extractPgsTracks, extractPgsTracksFromPacketBatches, renderPgsDisplaySetAsync } from "@bdmv2web/media-export";
import type { PgsDisplaySet, RenderedPgsDisplaySet } from "@bdmv2web/media-export";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ParsedDisc, StreamDeclaration } from "@bdmv2web/bdmv-parser";
import { equalsIgnoreCase } from "@bdmv2web/utils";
import type { DiscPgsPacketCache } from "./disc-pgs-packets.js";

export async function extractReachablePgsTracks(disc: ParsedDisc, scenes: Awaited<ReturnType<typeof extractIgsScenes>>["scenes"], outputDirectory: string, pathForReference?: (reference: ReturnType<typeof reachablePgsReferences>[number], index: number) => string, selectedReferences?: ReturnType<typeof reachablePgsReferences>, packets?: DiscPgsPacketCache) {
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
    const requests = tracks.map(({ reference, relativePath }) => ({ pid: reference.pid, outputPath: resolve(outputDirectory, relativePath), timestampOffset90k: BigInt(reference.sourceIn90k) }));
    const batches = packets?.take(sourcePath, requests);
    const outputs = batches === undefined ? await extractPgsTracks(sourcePath, requests) : await extractPgsTracksFromPacketBatches(sourcePath, batches, requests);
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

function isPrimaryPgs(stream: StreamDeclaration): stream is StreamDeclaration & { pid: number } {
  return stream.pid !== null && stream.streamType === 1 && stream.codingType === 0x90;
}

export function primaryPgsPidsByClip(disc: ParsedDisc, includePid: (pid: number) => boolean): Map<string, Set<number>> {
  const byClip = new Map<string, Set<number>>();
  for (const playlist of disc.playlists) for (const item of playlist.playItems) {
    for (const stream of item.streams) {
      if (!isPrimaryPgs(stream) || !includePid(stream.pid)) continue;
      const clipId = item.clipId.toUpperCase();
      const pids = byClip.get(clipId) ?? new Set<number>();
      pids.add(stream.pid);
      byClip.set(clipId, pids);
    }
  }
  return byClip;
}

export function reachablePgsReferences(disc: ParsedDisc, scenes: Awaited<ReturnType<typeof extractIgsScenes>>["scenes"]) {
  return reachableMediaPlaylists(disc, scenes).flatMap((nodeId) => {
    const playlistId = nodeId.slice("playlist:".length);
    const playlist = disc.playlists.find((item) => equalsIgnoreCase(item.id, playlistId));
    return playlist?.playItems.flatMap((item) => item.streams.filter(isPrimaryPgs)
      .map((stream, index) => ({ playlistId, playlistNumber: Number(playlistId), playItemIndex: item.index, clipId: item.clipId, pid: stream.pid, streamNumber: index + 1, language: stream.language ?? "und", sourceIn90k: String(item.inTime45k * 2), sourceOut90k: String(item.outTime45k * 2), source: `BDMV/STREAM/${item.clipId}.m2ts` }))) ?? [];
  });
}

/**
 * Deflate runs on the libuv threadpool, so more work in flight than the pool's
 * default size (four) only queues. Four full-HD canvases in flight keep peak
 * memory at roughly 70 MiB of pixels and use the whole pool.
 */
const PNG_ENCODE_CONCURRENCY = 4;

export interface DisplaySetPngPlan {
  /** Output-transaction staging directory the PNGs land in. */
  stagingPath: string;
  displaySets: readonly PgsDisplaySet[];
  /** PTS the recorded seconds are measured from. */
  origin90k: number;
  /** End PTS of one display set; `null` when the value cannot be anchored. */
  end90k: (index: number) => number | null;
  /** Package-relative path for one display set's PNG. */
  pathFor: (index: number) => string;
  /** Manifest record for one written PNG. */
  record: (rendered: RenderedPgsDisplaySet, index: number, path: string) => AssetRecord;
  level?: number | undefined;
  /** Called after each display set settles, whether or not it was visible. */
  onProgress?: ((completed: number, total: number) => void) | undefined;
}

/**
 * Render and write one PNG per visible display set. Compositing is synchronous but
 * cheap; deflate is neither, so several encodes stay in flight and the caller gets
 * display-set-order records for a deterministic manifest.
 */
export async function writeDisplaySetPngs(plan: DisplaySetPngPlan): Promise<AssetRecord[]> {
  const records = new Array<AssetRecord | null>(plan.displaySets.length).fill(null);
  // One mkdir per directory, shared by every encode in flight: awaiting the same
  // promise keeps a second display set from writing before the directory exists.
  const directories = new Map<string, Promise<unknown>>();
  let completed = 0;
  await mapWithConcurrency(plan.displaySets, PNG_ENCODE_CONCURRENCY, async (displaySet, index) => {
    const rendered = await renderPgsDisplaySetAsync(displaySet, index + 1, plan.end90k(index), plan.origin90k, { level: plan.level });
    if (rendered.visible) {
      const path = plan.pathFor(index);
      const target = resolve(plan.stagingPath, path);
      const directory = dirname(target);
      let created = directories.get(directory);
      if (created === undefined) { created = mkdir(directory, { recursive: true }); directories.set(directory, created); }
      await created;
      await writeFile(target, rendered.pngBytes, { flag: "wx" });
      records[index] = plan.record(rendered, index, path);
    }
    completed += 1;
    plan.onProgress?.(completed, plan.displaySets.length);
  });
  return records.filter((record): record is AssetRecord => record !== null);
}

export interface PgsTrackPngPlanOptions {
  /** Output-transaction staging directory the PNGs land in. */
  stagingPath: string;
  displaySets: readonly PgsDisplaySet[];
  /** PTS the recorded seconds are measured from. */
  origin90k: number;
  /** End PTS of one display set; `null` when the value cannot be anchored. */
  end90k: (index: number) => number | null;
  /** Package-relative path for one display set's PNG. */
  pathFor: (index: number) => string;
  /** Declared subtitle language; omitted when the source carries none. */
  language?: string | undefined;
  /** One-based stream number within the clip. */
  streamNumber?: number | undefined;
  level?: number | undefined;
  onProgress?: ((completed: number, total: number) => void) | undefined;
}

/**
 * PNG plan for one SUP track. Every command that renders display sets builds the
 * plan here, so `export` and `render` write the same manifest record for the same
 * display set.
 */
export function pgsTrackPngPlan(options: PgsTrackPngPlanOptions): DisplaySetPngPlan {
  return {
    stagingPath: options.stagingPath,
    displaySets: options.displaySets,
    origin90k: options.origin90k,
    end90k: options.end90k,
    pathFor: options.pathFor,
    level: options.level,
    onProgress: options.onProgress,
    record: (rendered, _index, path) => ({
      type: "sup-png",
      path,
      byteLength: rendered.pngBytes.byteLength,
      ...(options.language === undefined ? {} : { language: options.language }),
      ...(options.streamNumber === undefined ? {} : { streamNumber: options.streamNumber }),
      displaySet: rendered.displaySetNumber,
      startSeconds: rendered.startSeconds,
      endSeconds: rendered.endSeconds,
      width: rendered.width,
      height: rendered.height,
    }),
  };
}

/** Ratio callback for one track's share of a step that spans several tracks. */
export function trackProgress(progress: ProgressReporter, before: number, total: number): (completed: number) => void {
  return (completed) => progress.progress((before + completed) / total, `${before + completed}/${total} display sets`);
}

export interface DecodeTarget {
  /** Display sets this track contributes to the step's ratio. */
  displaySets: number;
  /** Render and write the track's PNGs, reporting its own progress. */
  write: (onProgress: (completed: number, total: number) => void) => Promise<AssetRecord[]>;
}

/** One progress step over every decoded display set of every SUP source. */
export async function runDecodeStep(progress: ProgressReporter, step: string, targets: DecodeTarget[], emptyDetail = "no display sets"): Promise<AssetRecord[]> {
  const total = targets.reduce((count, target) => count + target.displaySets, 0);
  if (total === 0) { progress.skip(step, emptyDetail); return []; }
  progress.start(step);
  const records: AssetRecord[] = [];
  let finished = 0;
  for (const target of targets) {
    records.push(...await target.write((completed) => progress.progress((finished + completed) / total, `${finished + completed}/${total} display sets`)));
    finished += target.displaySets;
  }
  progress.done(step, countOf(records.length, "PNG", "PNGs"));
  return records;
}
