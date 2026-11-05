import type { ParsedDisc, SourceLocation } from "@bdmv2web/bdmv-parser";
import type { MediaClosure } from "./closure.js";

export interface ExternalPlayItem {
  index: number;
  clipId: string;
  streamPath: string;
  present: boolean;
  sourceIn90k: string;
  sourceOut90k: string;
  playlistStart90k: string;
  playlistEnd90k: string;
  source: SourceLocation;
}
export interface ExternalPlaylist {
  id: string;
  source: SourceLocation;
  routes: MediaClosure["routes"];
  items: ExternalPlayItem[];
  marks: Array<{ index: number; playItemIndex: number; sourceTime90k: string; source: SourceLocation }>;
}
export interface ExternalMediaTargets {
  playlists: ExternalPlaylist[];
  unknown: MediaClosure["unknown"];
  complete: boolean;
}
export type ExternalPlayRequest =
  | { type: "PLAY_PLAYLIST"; playlist: number }
  | { type: "PLAY_PLAYLIST_ITEM"; playlist: number; playItem: number }
  | { type: "PLAY_PLAYLIST_MARK"; playlist: number; playMark: number };
export type ExternalPlayTarget =
  | { status: "available"; playlistId: string; item: ExternalPlayItem; sourceStart90k: string; remainingItems: ExternalPlayItem[]; limitations: string[] }
  | { status: "unavailable"; code: string; message: string };

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
      const playlistStart = cursor;
      if (end > start) cursor += end - start;
      return {
        index: item.index, clipId: item.clipId, streamPath: `STREAM/${item.clipId}.m2ts`,
        present: clips.get(`clip:${item.clipId}`.toLowerCase())?.state === "present",
        sourceIn90k: start.toString(), sourceOut90k: end.toString(),
        playlistStart90k: playlistStart.toString(), playlistEnd90k: cursor.toString(), source: item.source,
      };
    });
    playlists.push({ id: playlist.id, source: playlist.source, routes: closure.routes.filter((route) => route.playlistId.toLowerCase() === id.toLowerCase()), items,
      marks: playlist.marks.map((mark) => ({ index: mark.index, playItemIndex: mark.playItemRef, sourceTime90k: (BigInt(mark.time45k) * 2n).toString(), source: mark.source })) });
  }
  return { playlists, unknown: closure.unknown, complete: closure.complete && playlists.length === closure.playlistIds.length };
}

/** Resolve one VM request to its exact first source file and retain subsequent boundaries. */
export function resolveExternalPlayTarget(targets: ExternalMediaTargets, request: ExternalPlayRequest): ExternalPlayTarget {
  const unavailable = (code: string, message: string): ExternalPlayTarget => ({ status: "unavailable", code, message });
  if (!Number.isInteger(request.playlist) || request.playlist < 0 || request.playlist > 99999) return unavailable("EXTERNAL_PLAYLIST_INVALID", "Playlist number is invalid.");
  const playlistId = String(request.playlist).padStart(5, "0");
  const playlist = targets.playlists.find((item) => item.id === playlistId);
  if (!playlist) return unavailable("EXTERNAL_PLAYLIST_UNKNOWN", `Playlist ${playlistId} is not mapped.`);
  const mark = request.type === "PLAY_PLAYLIST_MARK" ? playlist.marks.find((item) => item.index === request.playMark) : undefined;
  if (request.type === "PLAY_PLAYLIST_MARK" && !mark) return unavailable("EXTERNAL_MARK_UNKNOWN", `Playlist ${playlistId} does not contain mark ${request.playMark}.`);
  const itemIndex = request.type === "PLAY_PLAYLIST_ITEM" ? request.playItem : mark?.playItemIndex ?? 0;
  const position = playlist.items.findIndex((item) => item.index === itemIndex);
  if (position < 0) return unavailable("EXTERNAL_PLAYITEM_UNKNOWN", `Playlist ${playlistId} does not contain PlayItem ${itemIndex}.`);
  const item = playlist.items[position]!;
  const start = BigInt(mark?.sourceTime90k ?? item.sourceIn90k); const end = BigInt(item.sourceOut90k);
  if (end <= BigInt(item.sourceIn90k) || start < BigInt(item.sourceIn90k) || start >= end) return unavailable("EXTERNAL_TIME_INVALID", `Playlist ${playlistId} PlayItem ${itemIndex} has an invalid interval or mark.`);
  if (!item.present) return unavailable("EXTERNAL_STREAM_MISSING", `Source ${item.streamPath} is missing.`);
  const remainingItems = playlist.items.slice(position + 1);
  const limitations = ["The default media player opens the entire M2TS file; PlayItem IN/OUT and mark offsets are not enforced."];
  if (remainingItems.length) limitations.push("Subsequent PlayItems require separate handling and are not played automatically.");
  return { status: "available", playlistId, item, sourceStart90k: start.toString(), remainingItems, limitations };
}
