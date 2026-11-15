import type { ParsedDisc } from "@bdmv2web/bdmv-parser";
import type { ExternalMediaTargets, ExternalPlayItem, ExternalPlaylist } from "@bdmv2web/core/playback-targets";
import type { MediaClosure } from "./closure.js";

/**
 * The playback-target protocol lives in `@bdmv2web/core/playback-targets`.
 * These exports keep the existing media-export import paths working and map
 * them to the core types and resolver.
 */
export {
  EXTERNAL_UNKNOWN_CODES,
  isDeclaredExternalStreamPath,
  resolveExternalPlayTarget,
} from "@bdmv2web/core/playback-targets";
export type {
  ExternalMediaTargets,
  ExternalPlayItem,
  ExternalPlaylist,
  ExternalPlayRequest,
  ExternalPlayTarget,
  PlaybackRoute,
  PlaybackSourceLocation,
  PlaybackUnknown,
} from "@bdmv2web/core/playback-targets";

/** Preserve the playlist order and source-time bounds without exporting or joining source clips. */
export function createExternalMediaTargets(disc: ParsedDisc, closure: MediaClosure): ExternalMediaTargets {
  const clips = new Map(disc.graph.nodes.filter((node) => node.type === "clip").map((node) => [node.id.toLowerCase(), node]));
  const playlists: ExternalPlaylist[] = [];
  for (const id of closure.playlistIds) {
    const playlist = disc.playlists.find((candidate) => `playlist:${candidate.id}`.toLowerCase() === id.toLowerCase());
    if (!playlist) continue;
    let cursor = 0n;
    const items = playlist.playItems.map((item): ExternalPlayItem => {
      const start = BigInt(item.inTime45k) * 2n;
      const end = BigInt(item.outTime45k) * 2n;
      const clipInfo = disc.clips.find((candidate) => candidate.id.toLowerCase() === item.clipId.toLowerCase());
      const stc = clipInfo?.sequence.flatMap((atc) => atc.stcs.map((sequence, index) => ({
        id: atc.offsetStcId + index,
        presentationStartPts: sequence.presentationStartPts,
      }))).find((sequence) => sequence.id === item.stcId);
      const playlistStart = cursor;
      if (end > start) cursor += end - start;
      return {
        index: item.index, stcId: item.stcId, clipId: item.clipId, streamPath: `STREAM/${item.clipId}.m2ts`,
        present: clips.get(`clip:${item.clipId}`.toLowerCase())?.state === "present",
        sourceOrigin90k: stc ? (BigInt(stc.presentationStartPts) * 2n).toString() : null,
        sourceIn90k: start.toString(), sourceOut90k: end.toString(),
        playlistStart90k: playlistStart.toString(), playlistEnd90k: cursor.toString(), source: item.source,
      };
    });
    playlists.push({ id: playlist.id, source: playlist.source, routes: closure.routes.filter((route) => route.playlistId.toLowerCase() === id.toLowerCase()), items,
      marks: playlist.marks.map((mark) => ({ index: mark.index, playItemIndex: mark.playItemRef, sourceTime90k: (BigInt(mark.time45k) * 2n).toString(), source: mark.source })) });
  }
  return { playlists, unknown: closure.unknown, complete: closure.complete && playlists.length === closure.playlistIds.length };
}
