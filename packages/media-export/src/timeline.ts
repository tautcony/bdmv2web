/** Exact 90 kHz media time persisted as a canonical non-negative decimal string. */
export type Time90k = string;

export type SourceTimebase = "45k" | "90k";

export interface MediaTimelineMapping {
  /** Unique mapping-row identity. Repeated references to one Clip need distinct IDs. */
  mappingId: string;
  playlistId: string;
  playItemId: string;
  clipId: string;
  variantId: string;
  sourceIn90k: Time90k;
  sourceOut90k: Time90k;
  playlistStart90k: Time90k;
  playlistEnd90k: Time90k;
  assetId: string;
  mediaStart90k: Time90k;
  mediaEnd90k: Time90k;
  /** PTS discontinuity/wrap domain. Values from another epoch never match. */
  timestampEpoch: string;
  /** Original source clock; mapping coordinates above are normalized to 90 kHz. */
  sourceTimebase: SourceTimebase;
}

export interface MediaTimelinePosition {
  mapping: MediaTimelineMapping;
  sourceTime90k: Time90k;
  playlistTime90k: Time90k;
  mediaTime90k: Time90k;
}

/** Normalize a source timestamp to the exact 90 kHz mapping domain. */
export function normalizeSourceTime(value: string | bigint | number, timebase: SourceTimebase): Time90k {
  const ticks = parseTime(value, "source timestamp");
  return (timebase === "45k" ? ticks * 2n : ticks).toString();
}

/**
 * A linear, no-resampling map across source, playlist and encoded-media clocks.
 * Every interval is half-open. Lookups at a shared boundary therefore resolve
 * to the following PlayItem, and lookups at the final end return null.
 */
export class MediaTimelineMap {
  readonly mappings: readonly MediaTimelineMapping[];
  private readonly byId: ReadonlyMap<string, MediaTimelineMapping>;

  constructor(mappings: readonly MediaTimelineMapping[]) {
    const ids = new Set<string>();
    const normalized = mappings.map((mapping) => validateMapping(mapping));
    for (const mapping of normalized) {
      if (ids.has(mapping.mappingId)) throw new TypeError(`Duplicate timeline mappingId '${mapping.mappingId}'.`);
      ids.add(mapping.mappingId);
    }
    validateNoPlaylistOverlap(normalized);
    this.mappings = normalized;
    this.byId = new Map(normalized.map((mapping) => [mapping.mappingId, mapping]));
  }

  /** Map one source timestamp. mappingId and epoch keep repeated Clips/discontinuities distinct. */
  sourceToPlaylist(mappingId: string, sourceTime: string | bigint | number, timestampEpoch: string): MediaTimelinePosition | null {
    const mapping = this.byId.get(mappingId);
    if (!mapping || mapping.timestampEpoch !== timestampEpoch) return null;
    const normalized = BigInt(normalizeSourceTime(sourceTime, mapping.sourceTimebase));
    const sourceIn = BigInt(mapping.sourceIn90k);
    const sourceOut = BigInt(mapping.sourceOut90k);
    if (!inHalfOpen(normalized, sourceIn, sourceOut)) return null;
    const playlist = BigInt(mapping.playlistStart90k) + normalized - sourceIn;
    const media = BigInt(mapping.mediaStart90k) + playlist - BigInt(mapping.playlistStart90k);
    return position(mapping, normalized, playlist, media);
  }

  /** Resolve a playlist timestamp to its PlayItem/source/media position. */
  playlistToSource(playlistId: string, playlistTime90k: string | bigint | number): MediaTimelinePosition | null {
    const time = parseTime(playlistTime90k, "playlist timestamp");
    const mapping = this.mappings.find((item) => item.playlistId === playlistId && inHalfOpen(time, BigInt(item.playlistStart90k), BigInt(item.playlistEnd90k)));
    if (!mapping) return null;
    const source = BigInt(mapping.sourceIn90k) + time - BigInt(mapping.playlistStart90k);
    const media = BigInt(mapping.mediaStart90k) + time - BigInt(mapping.playlistStart90k);
    return position(mapping, source, time, media);
  }

  /** Resolve encoded media time back to playlist/source time. */
  mediaToSource(assetId: string, mediaTime90k: string | bigint | number, mappingId?: string): MediaTimelinePosition | null {
    const time = parseTime(mediaTime90k, "media timestamp");
    const candidates = this.mappings.filter((item) => item.assetId === assetId && (mappingId === undefined || item.mappingId === mappingId) && inHalfOpen(time, BigInt(item.mediaStart90k), BigInt(item.mediaEnd90k)));
    if (candidates.length > 1) throw new Error(`Media time '${time}' is ambiguous for asset '${assetId}'; pass mappingId.`);
    const mapping = candidates[0];
    if (!mapping) return null;
    const playlist = BigInt(mapping.playlistStart90k) + time - BigInt(mapping.mediaStart90k);
    const source = BigInt(mapping.sourceIn90k) + playlist - BigInt(mapping.playlistStart90k);
    return position(mapping, source, playlist, time);
  }
}

function validateMapping(mapping: MediaTimelineMapping): MediaTimelineMapping {
  for (const [name, value] of Object.entries({
    sourceIn90k: mapping.sourceIn90k, sourceOut90k: mapping.sourceOut90k,
    playlistStart90k: mapping.playlistStart90k, playlistEnd90k: mapping.playlistEnd90k,
    mediaStart90k: mapping.mediaStart90k, mediaEnd90k: mapping.mediaEnd90k,
  })) parseTime(value, `${mapping.mappingId}.${name}`);
  for (const key of ["mappingId", "playlistId", "playItemId", "clipId", "variantId", "assetId", "timestampEpoch"] as const) {
    if (typeof mapping[key] !== "string" || mapping[key].trim() === "") throw new TypeError(`Timeline mapping '${mapping.mappingId}' requires ${key}.`);
  }
  const sourceDuration = BigInt(mapping.sourceOut90k) - BigInt(mapping.sourceIn90k);
  const playlistDuration = BigInt(mapping.playlistEnd90k) - BigInt(mapping.playlistStart90k);
  const mediaDuration = BigInt(mapping.mediaEnd90k) - BigInt(mapping.mediaStart90k);
  if (sourceDuration <= 0n || playlistDuration <= 0n || mediaDuration <= 0n) throw new RangeError(`Timeline mapping '${mapping.mappingId}' intervals must be positive.`);
  if (sourceDuration !== playlistDuration || playlistDuration !== mediaDuration) throw new RangeError(`Timeline mapping '${mapping.mappingId}' is not a linear equal-duration mapping.`);
  if (mapping.sourceTimebase !== "45k" && mapping.sourceTimebase !== "90k") throw new TypeError(`Timeline mapping '${mapping.mappingId}' has unsupported sourceTimebase.`);
  return { ...mapping };
}

function validateNoPlaylistOverlap(mappings: readonly MediaTimelineMapping[]): void {
  const groups = new Map<string, MediaTimelineMapping[]>();
  for (const mapping of mappings) groups.set(mapping.playlistId, [...(groups.get(mapping.playlistId) ?? []), mapping]);
  for (const [playlistId, items] of groups) {
    const sorted = [...items].sort((left, right) => compareTime(left.playlistStart90k, right.playlistStart90k));
    for (let index = 1; index < sorted.length; index++) {
      if (BigInt(sorted[index]!.playlistStart90k) < BigInt(sorted[index - 1]!.playlistEnd90k)) {
        throw new RangeError(`Playlist '${playlistId}' timeline mappings overlap.`);
      }
    }
  }
}

function parseTime(value: string | bigint | number, label: string): bigint {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer.`);
    return BigInt(value);
  }
  if (typeof value === "bigint") {
    if (value < 0n) throw new RangeError(`${label} must be non-negative.`);
    return value;
  }
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new TypeError(`${label} must be a canonical non-negative integer string.`);
  return BigInt(value);
}

function inHalfOpen(value: bigint, start: bigint, end: bigint): boolean { return value >= start && value < end; }
function compareTime(left: string, right: string): number { const a = BigInt(left), b = BigInt(right); return a < b ? -1 : a > b ? 1 : 0; }
function position(mapping: MediaTimelineMapping, source: bigint, playlist: bigint, media: bigint): MediaTimelinePosition {
  return { mapping, sourceTime90k: source.toString(), playlistTime90k: playlist.toString(), mediaTime90k: media.toString() };
}
