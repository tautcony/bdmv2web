/**
 * Playback-target protocol shared by the browser runtime and the media pipeline.
 *
 * These are wire types: they describe declared playlist/PlayItem/mark targets
 * and the exact source interval to hand to an external player. The browser
 * runtime reads the protocol directly; disc parsing and media conversion stay
 * with the packages that produce them.
 */

/** Source location of a declared structure. */
export interface PlaybackSourceLocation {
  path: string;
  origin: "primary" | "backup";
  offset: string;
  instructionIndex?: number;
}

/** One route that made a playlist reachable during media closure. */
export interface PlaybackRoute {
  playlistId: string;
  origin: "entry" | "button-program" | "conservative-fallback";
  entryId: string | null;
  entrySource: PlaybackSourceLocation | null;
  buttonProgramId: number | null;
  navigationEdges: Array<{ from: string; to: string | null; kind: string; condition: string | null; source: PlaybackSourceLocation }>;
}

/** A media-closure finding that leaves a target unproven. */
export interface PlaybackUnknown {
  code: string;
  message: string;
  source: PlaybackSourceLocation | null;
}

export interface ExternalPlayItem {
  index: number;
  stcId: number;
  clipId: string;
  streamPath: string;
  present: boolean;
  /** Start of the PlayItem's CLPI STC clock, in 90 kHz ticks; null when unresolved. */
  sourceOrigin90k: string | null;
  sourceIn90k: string;
  sourceOut90k: string;
  playlistStart90k: string;
  playlistEnd90k: string;
  source: PlaybackSourceLocation;
}
export interface ExternalPlaylist {
  id: string;
  source: PlaybackSourceLocation;
  routes: PlaybackRoute[];
  items: ExternalPlayItem[];
  marks: Array<{ index: number; playItemIndex: number; sourceTime90k: string; source: PlaybackSourceLocation }>;
}
export interface ExternalMediaTargets {
  playlists: ExternalPlaylist[];
  unknown: PlaybackUnknown[];
  complete: boolean;
}
export type ExternalPlayRequest =
  | { type: "PLAY_PLAYLIST"; playlist: number }
  | { type: "PLAY_PLAYLIST_ITEM"; playlist: number; playItem: number }
  | { type: "PLAY_PLAYLIST_MARK"; playlist: number; playMark: number };
export type ExternalPlayTarget =
  | { status: "available"; playlistId: string; item: ExternalPlayItem; clipTime90k: string; seekTime90k: string | null; remainingItems: ExternalPlayItem[] }
  | { status: "unavailable"; code: string; message: string; source?: PlaybackSourceLocation };

/** Diagnostic codes that mark an external target as unknown. */
export const EXTERNAL_UNKNOWN_CODES = ["EXTERNAL_PLAYLIST_UNKNOWN", "EXTERNAL_MARK_UNKNOWN", "EXTERNAL_PLAYITEM_UNKNOWN"] as const;

const [EXTERNAL_PLAYLIST_UNKNOWN, EXTERNAL_MARK_UNKNOWN, EXTERNAL_PLAYITEM_UNKNOWN] = EXTERNAL_UNKNOWN_CODES;

export function isDeclaredExternalStreamPath(clipId: unknown, streamPath: unknown): boolean {
  return typeof clipId === "string" && /^[0-9]{5}$/.test(clipId)
    && typeof streamPath === "string" && streamPath === `STREAM/${clipId}.m2ts`;
}

/** Resolve one VM request to its exact first source file and retain subsequent boundaries. */
export function resolveExternalPlayTarget(targets: ExternalMediaTargets, request: ExternalPlayRequest, options: { allowMissing?: boolean } = {}): ExternalPlayTarget {
  const unavailable = (code: string, message: string, source?: PlaybackSourceLocation): ExternalPlayTarget => ({ status: "unavailable", code, message, ...(source ? { source } : {}) });
  if (!Number.isInteger(request.playlist) || request.playlist < 0 || request.playlist > 99999) return unavailable("EXTERNAL_PLAYLIST_INVALID", "Playlist number is invalid.");
  const playlistId = String(request.playlist).padStart(5, "0");
  const playlist = targets.playlists.find((item) => item.id === playlistId);
  if (!playlist) return unavailable(EXTERNAL_PLAYLIST_UNKNOWN, `Playlist ${playlistId} is not mapped.`);
  const mark = request.type === "PLAY_PLAYLIST_MARK" ? playlist.marks.find((item) => item.index === request.playMark) : undefined;
  if (request.type === "PLAY_PLAYLIST_MARK" && !mark) return unavailable(EXTERNAL_MARK_UNKNOWN, `Playlist ${playlistId} does not contain mark ${request.playMark}.`);
  const itemIndex = request.type === "PLAY_PLAYLIST_ITEM" ? request.playItem : mark?.playItemIndex ?? 0;
  const position = playlist.items.findIndex((item) => item.index === itemIndex);
  if (position < 0) return unavailable(EXTERNAL_PLAYITEM_UNKNOWN, `Playlist ${playlistId} does not contain PlayItem ${itemIndex}.`);
  const item = playlist.items[position]!;
  if (!isDeclaredExternalStreamPath(item.clipId, item.streamPath)) return unavailable("EXTERNAL_TARGET_UNDECLARED", `External target for Clip '${item.clipId}' must use STREAM/${item.clipId}.m2ts; received '${item.streamPath}'.`, item.source);
  const start = BigInt(mark?.sourceTime90k ?? item.sourceIn90k); const end = BigInt(item.sourceOut90k);
  if (end <= BigInt(item.sourceIn90k) || start < BigInt(item.sourceIn90k) || start >= end) return unavailable("EXTERNAL_TIME_INVALID", `Playlist ${playlistId} PlayItem ${itemIndex} has an invalid interval or mark.`);
  if (!item.present && !options.allowMissing) return unavailable("EXTERNAL_STREAM_MISSING", `Source ${item.streamPath} is missing.`);
  const remainingItems = playlist.items.slice(position + 1);
  const sourceOrigin = item.sourceOrigin90k === null ? null : BigInt(item.sourceOrigin90k);
  if (sourceOrigin !== null && start < sourceOrigin) return unavailable("EXTERNAL_TIME_BEFORE_STC", `Playlist ${playlistId} target time precedes the selected Clip STC start time.`);
  return { status: "available", playlistId, item, clipTime90k: start.toString(), seekTime90k: sourceOrigin === null ? null : (start - sourceOrigin).toString(), remainingItems };
}
