import type { ParsedDisc, PlayItem, Playlist, PlayMark, SourceLocation } from "@bdmv2web/bdmv-parser";

const TICKS_PER_SECOND = 45_000n;

export interface ProjectedMark {
  mark: PlayMark;
  chapterTime45k: bigint | null;
}

export interface ProjectedPlaylist {
  playlist: Playlist;
  duration45k: bigint | null;
  marks: ProjectedMark[];
}

export interface InspectReportProjection {
  disc: ParsedDisc;
  playlists: ProjectedPlaylist[];
}

export function renderInspectReport(projection: InspectReportProjection, stageStatus: "complete" | "partial" | "failed"): string {
  const { disc } = projection;
  const lines = [`BDMV inspection (structural analysis; stage ${stageStatus})`];
  const names = (disc.metadata ?? []).map((metadata) => `${metadata.language}: ${metadata.discName ?? "unknown"} (${formatSource(metadata.source)})`);
  const uhd = disc.discInfo.uhd;
  lines.push(`Disc: ${names.join("; ") || "unknown"} | UHD: ${uhd ? (uhd.exists4k ? "yes" : "no") : "unknown"}`);
  lines.push(`Disc source: ${uhd ? formatSource(uhd.source) : disc.discInfo.appInfo ? formatSource(disc.discInfo.appInfo.source) : "unknown"}`);
  const appInfo = disc.discInfo.appInfo;
  lines.push(appInfo
    ? `Disc application: content exists ${appInfo.contentExistFlag ? "yes" : "no"}, initial output mode ${appInfo.initialOutputModePreference ? "yes" : "no"}, dynamic range type ${appInfo.initialDynamicRangeType}, video format code ${appInfo.videoFormat}, frame-rate code ${appInfo.frameRate} (${formatSource(appInfo.source)})`
    : "Disc application: unknown");
  lines.push("", "Navigation entries:");
  if (disc.entries.length === 0) lines.push("  none");
  for (const entry of disc.entries) {
    const target = entry.target.target === null ? "unknown" : String(entry.target.target);
    lines.push(`  ${entry.kind} ${entry.id} → ${entry.target.objectType} ${target} (${formatSource(entry.source)})`);
  }
  lines.push(`Movie objects: ${disc.movieObjects.length ? disc.movieObjects.map((object) => `${object.id} (${object.instructions.length} instructions; ${formatSource(object.source)})`).join("; ") : "none"}`);

  lines.push("", `Playlists (${projection.playlists.length}):`);
  if (projection.playlists.length === 0) lines.push("  none");
  for (const { playlist, duration45k } of projection.playlists) {
    lines.push(`  ${playlist.id}  duration ${format45kTime(duration45k)}  ${playlist.playItems.length} PlayItem(s)  source ${formatSource(playlist.source)}`);
  }
  for (const projected of projection.playlists) {
    const { playlist } = projected;
    lines.push("", `Playlist ${playlist.id} details:`);
    if (playlist.playItems.length === 0) lines.push("  PlayItems: none");
    for (const item of playlist.playItems) {
      lines.push(`  PlayItem ${item.index}  clip ${item.clipId}.${item.codecId}  IN ${format45kTime(item.inTime45k)}  OUT ${format45kTime(item.outTime45k)}  source ${formatSource(item.source)}`);
      lines.push(`    Angle: count ${item.angleCount}, multi-angle ${item.multiAngle ? "yes" : "no"}, seamless ${item.seamlessAngle ? "yes" : "no"}`);
      lines.push("    Declared angles:");
      if (item.angles?.length) {
        for (const angle of item.angles) lines.push(`      Angle ${angle.index}: ${angle.clipId}.${angle.codecId}, STC ${angle.stcId} (${formatSource(angle.source)})`);
      } else lines.push("      none");
      lines.push("    MPLS stream declarations:");
      if (item.streams.length === 0) lines.push("      none");
      for (const stream of item.streams) {
        const category = stream.category ? `${stream.category}${stream.categoryIndex === undefined ? "" : `[${stream.categoryIndex}]`}` : `streamType ${stream.streamType}`;
        lines.push(`      ${category}  PID ${formatHex(stream.pid)}  coding ${formatHex(stream.codingType)}  language ${stream.language ?? "unknown"}  (${formatSource(stream.source)})`);
      }
      const clip = disc.clips.find((candidate) => candidate.id.toUpperCase() === item.clipId.toUpperCase());
      const clipStreams = clip?.programs.flatMap((program) => program.streams) ?? [];
      lines.push("    CLPI program stream declarations:");
      if (!clip) lines.push("      unknown (CLPI unavailable)");
      else if (clipStreams.length === 0) lines.push("      none");
      for (const stream of clipStreams) lines.push(`      PID 0x${stream.pid.toString(16).toUpperCase()}  coding 0x${stream.codingType.toString(16).toUpperCase()}  language ${stream.language ?? "unknown"}  (${formatSource(stream.source)})`);
    }
    lines.push("  Playlist marks:");
    if (projected.marks.length === 0) lines.push("    none");
    for (const { mark, chapterTime45k } of projected.marks) {
      const item = playlist.playItems[mark.playItemRef];
      const valid = !!item && playItemDuration(item) !== null && Number.isSafeInteger(mark.time45k) && mark.time45k >= item.inTime45k && mark.time45k <= item.outTime45k;
      const validity = valid ? "valid" : !item ? `invalid: PlayItem reference ${mark.playItemRef} is out of range` : playItemDuration(item) === null ? `invalid: PlayItem ${mark.playItemRef} has an invalid interval` : `invalid: time outside PlayItem ${mark.playItemRef}`;
      lines.push(`    Mark ${mark.index} type ${mark.type}  PlayItem ${mark.playItemRef}  raw ${format45kTime(mark.time45k)} (${mark.time45k} ticks)  chapter ${format45kTime(chapterTime45k)}  ${validity}  (${formatSource(mark.source)})`);
    }
  }

  const clipMarks = disc.clips.flatMap((clip) => (clip.clipMarks ?? []).map((mark) => ({ clip, mark })));
  lines.push("", "CLPI clip marks:");
  if (clipMarks.length === 0) lines.push("  none");
  for (const { clip, mark } of clipMarks) lines.push(`  ${clip.id} mark ${mark.index} type ${mark.markType}  PTS90k ${format90kTime(mark.pts90k)} (${mark.pts90k} ticks)  duration45k ${mark.duration45k} ticks  (${formatSource(mark.source)})`);

  lines.push("", `Diagnostics (${disc.diagnostics.length}):`);
  if (disc.diagnostics.length === 0) lines.push("  none");
  for (const diagnostic of disc.diagnostics) {
    lines.push(`  ${diagnostic.severity} ${diagnostic.code} — ${diagnostic.message}`);
    lines.push(`    source ${diagnostic.sourcePath ?? "unknown"}${diagnostic.offset === null ? "" : ` @ ${diagnostic.offset}`}`);
  }

  return `${lines.join("\n")}\n`;
}

export function format45kTime(ticks: number | bigint | null): string {
  if (ticks === null) return "unknown";
  const value = typeof ticks === "bigint" ? ticks : Number.isSafeInteger(ticks) ? BigInt(ticks) : null;
  if (value === null || value < 0n) return "unknown";
  const milliseconds = value * 1_000n / TICKS_PER_SECOND;
  const hours = milliseconds / 3_600_000n;
  const minutes = milliseconds / 60_000n % 60n;
  const seconds = milliseconds / 1_000n % 60n;
  const fraction = milliseconds % 1_000n;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${fraction.toString().padStart(3, "0")}`;
}

export function projectInspectReport(disc: ParsedDisc): InspectReportProjection {
  return {
    disc,
    playlists: disc.playlists.map((playlist) => projectPlaylist(playlist)),
  };
}

function projectPlaylist(playlist: Playlist): ProjectedPlaylist {
  const durations = playlist.playItems.map(playItemDuration);
  const duration45k = durations.every((duration): duration is bigint => duration !== null)
    ? durations.reduce((total, duration) => total + duration, 0n)
    : null;
  const marks = playlist.marks.map((mark) => ({ mark, chapterTime45k: chapterTime(playlist.playItems, mark) }));
  return { playlist, duration45k, marks };
}

function playItemDuration(item: PlayItem): bigint | null {
  if (!Number.isSafeInteger(item.inTime45k) || !Number.isSafeInteger(item.outTime45k) || item.inTime45k < 0 || item.outTime45k < item.inTime45k) return null;
  return BigInt(item.outTime45k) - BigInt(item.inTime45k);
}

function chapterTime(items: PlayItem[], mark: PlayMark): bigint | null {
  if (!Number.isSafeInteger(mark.playItemRef) || mark.playItemRef < 0 || mark.playItemRef >= items.length || !Number.isSafeInteger(mark.time45k) || mark.time45k < 0) return null;
  let elapsed = 0n;
  for (let index = 0; index < mark.playItemRef; index++) {
    const duration = playItemDuration(items[index]!);
    if (duration === null) return null;
    elapsed += duration;
  }
  const item = items[mark.playItemRef]!;
  if (playItemDuration(item) === null || mark.time45k < item.inTime45k || mark.time45k > item.outTime45k) return null;
  return elapsed + BigInt(mark.time45k) - BigInt(item.inTime45k);
}

export function formatSource(source: SourceLocation | null | undefined): string {
  return source ? `${source.path} @ ${source.offset} (${source.origin})` : "unknown";
}

function formatHex(value: number | null): string {
  return value === null ? "unknown" : `0x${value.toString(16).toUpperCase()}`;
}

function format90kTime(ticks: number): string {
  if (!Number.isSafeInteger(ticks) || ticks < 0) return "unknown";
  const milliseconds = BigInt(ticks) * 1_000n / 90_000n;
  const hours = milliseconds / 3_600_000n;
  const minutes = milliseconds / 60_000n % 60n;
  const seconds = milliseconds / 1_000n % 60n;
  const fraction = milliseconds % 1_000n;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${fraction.toString().padStart(3, "0")}`;
}
