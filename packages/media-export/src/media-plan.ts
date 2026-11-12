import type { ParsedDisc, PlayItem, SourceLocation, StreamDeclaration, SubPlayItem } from "@bdmv2web/bdmv-parser";
import type { MediaClosure } from "./closure.js";
import { estimateBytes } from "./budget.js";
import { equalsIgnoreCase as sameId } from "@bdmv2web/utils";

export interface MediaPlanOptions {
  /** Estimated output rates, not measurements from source media; defaults are 8 Mb/s video and 192 kb/s per audio track. */
  estimatedVideoBitsPerSecond?: number;
  estimatedAudioBitsPerSecond?: number;
  containerOverheadPercent?: number;
}

export interface PlannedTrack {
  role: "video" | "audio" | "subtitle" | "unknown";
  streamType: number;
  codingType: number | null;
  pid: number | null;
  subPathId: number | null;
  subClipId: number | null;
  language: string | null;
  source: SourceLocation;
}

export interface MediaPlanRequirement {
  playlistId: string;
  playlistSource: SourceLocation;
  routes: MediaClosure["routes"];
  playItems: Array<{
    index: number;
    clipId: string;
    codecId: string;
    stcId: number;
    source: SourceLocation;
    streamFile: { path: string; present: boolean; source: SourceLocation | null };
    clipInfo: { id: string; present: boolean; source: SourceLocation | null };
    sourceIn45k: number;
    sourceOut45k: number;
    sourceIn90k: string;
    sourceOut90k: string;
    duration90k: string;
    durationSeconds: number;
    connectionCondition: number;
    uoMask: string;
    stillMode: number;
    stillTime: number;
    angle: { multiAngle: boolean; angleCount: number; differentAudio: boolean; seamlessAngle: boolean };
    tracks: PlannedTrack[];
    strategy: { grouping: "per-play-item"; container: "mp4"; video: "h264"; audio: "aac"; status: "planned" | "partial"; reasons: string[] };
    estimate: { bytes: string | null; rateBitsPerSecond: number | null; reason?: string };
  }>;
  subPaths: Array<{
    index: number;
    type: number;
    repeat: boolean;
    source: SourceLocation;
    items: Array<{ clipId: string; codecId: string; stcId: number; sourceIn45k: number; sourceOut45k: number; syncPlayItemId: number; syncPts45k: number; source: SourceLocation; streamFile: { path: string; present: boolean; source: SourceLocation | null }; clipInfo: { id: string; present: boolean; source: SourceLocation | null }; tracks: PlannedTrack[] }>;
    status: "unsupported";
    reason: string;
  }>;
}

export type MediaCapability = "seamless" | "angle" | "pip" | "hdr" | "forced-subtitle" | "textst";

export interface MediaCapabilityImpact {
  capability: MediaCapability;
  status: "unsupported" | "unknown";
  inspection: "inspected" | "partially-inspected" | "not-inspected";
  message: string;
  affected: Array<{ playlistId: string; playItemIndex: number | null; source: SourceLocation }>;
}

export interface MediaCapabilityReport {
  inspectedStages: ["M1"];
  notInspectedStages: ["M2"];
  strictUpgradeAllowed: false;
  impacts: MediaCapabilityImpact[];
}

export interface MediaPlan {
  schemaVersion: "1.0";
  status: "partial";
  reachability: { complete: boolean; explored: number; unknown: MediaClosure["unknown"] };
  strategy: { grouping: "per-play-item"; container: "mp4"; video: "h264"; audio: "aac"; transcodingStarted: false };
  budget: {
    estimatedVideoBitsPerSecond: number;
    estimatedAudioBitsPerSecond: number;
    containerOverheadPercent: number;
    estimatedDuration90k: string;
    knownSubtotalBytes: string;
    estimatedTotalBytes: string | null;
    estimateBasis: "configured-target-bitrate-assumption";
    status: "estimated" | "unknown";
    reason?: string;
    deduplicationApplied: false;
  };
  requirements: MediaPlanRequirement[];
  capabilityReport: MediaCapabilityReport;
  diagnostics: Array<{ code: string; message: string; source: SourceLocation | null }>;
}

const VIDEO_CODING_TYPES = new Set([0x01, 0x02, 0x1b, 0x20, 0x24, 0xea]);
const AUDIO_CODING_TYPES = new Set([0x03, 0x04, 0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0xa1, 0xa2]);
const SUBTITLE_CODING_TYPES = new Set([0x90]);

/** Build a source-traceable pre-transcode plan from M1 declarations and M5 closure. */
export function createMediaPlan(disc: ParsedDisc, closure: MediaClosure, options: MediaPlanOptions = {}): MediaPlan {
  const videoRate = options.estimatedVideoBitsPerSecond ?? 8_000_000;
  const audioRate = options.estimatedAudioBitsPerSecond ?? 192_000;
  const overheadPercent = options.containerOverheadPercent ?? 5;
  for (const [name, value] of [["estimatedVideoBitsPerSecond", videoRate], ["estimatedAudioBitsPerSecond", audioRate]] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  }
  if (!Number.isSafeInteger(overheadPercent) || overheadPercent < 0 || overheadPercent > 100) throw new RangeError("containerOverheadPercent must be an integer from 0 through 100");

  const graphNodes = new Map(disc.graph.nodes.map((node) => [node.id, node]));
  const diagnostics: MediaPlan["diagnostics"] = closure.unknown.map((item) => ({ ...item }));
  let durationTotal90k = 0n;
  let knownSubtotalBytes = 0n;
  let unknownEstimateCount = 0;
  const requirements: MediaPlanRequirement[] = [];

  for (const playlistNodeId of closure.playlistIds) {
    const playlistId = playlistNodeId.slice("playlist:".length);
    const playlist = disc.playlists.find((item) => sameId(item.id, playlistId));
    const playlistSource = playlist?.source ?? graphNodes.get(playlistNodeId)?.source ?? { path: `BDMV/PLAYLIST/${playlistId}.mpls`, origin: "primary", offset: "0" };
    if (!playlist) diagnostics.push({ code: "MEDIA_PLAYLIST_MISSING", message: `Reachable playlist '${playlistId}' is absent from ParsedDisc.`, source: playlistSource });
    const routes = closure.routes.filter((route) => route.playlistId === playlistNodeId);
    const playItems = (playlist?.playItems ?? []).map((item) => planPlayItem(item, playlistId, closure, videoRate, audioRate, overheadPercent, diagnostics));
    for (const item of playItems) {
      const duration = BigInt(item.duration90k);
      durationTotal90k += duration;
      if (item.estimate.bytes === null) unknownEstimateCount++;
      else knownSubtotalBytes += BigInt(item.estimate.bytes);
    }
    const subPaths = (playlist?.subPaths ?? []).map((subPath, index) => {
      if (subPath.items.length > 0) unknownEstimateCount++;
      diagnostics.push({ code: "MEDIA_SUBPATH_UNSUPPORTED", message: `Playlist '${playlistId}' subpath ${index} is retained in the plan but its playback role is not implemented.`, source: subPath.source });
      return {
        index, type: subPath.type, repeat: subPath.repeat, source: subPath.source,
        items: subPath.items.map((item) => planSubPlayItem(item, disc)),
        status: "unsupported" as const,
        reason: "SubPath/SubPlayItem references are preserved; secondary presentation/export behavior is not inferred.",
      };
    });
    requirements.push({
      playlistId, playlistSource, routes, playItems, subPaths,
    });
  }
  const estimateUnknown = unknownEstimateCount > 0 || !closure.complete;
  const capabilityReport = buildCapabilityReport(requirements);
  for (const impact of capabilityReport.impacts) {
    diagnostics.push({
      code: `MEDIA_CAPABILITY_${impact.capability.toUpperCase().replaceAll("-", "_")}_${impact.status.toUpperCase()}`,
      message: impact.message,
      source: impact.affected[0]?.source ?? null,
    });
  }
  return {
    schemaVersion: "1.0",
    status: "partial",
    reachability: { complete: closure.complete, explored: closure.explored, unknown: closure.unknown },
    strategy: { grouping: "per-play-item", container: "mp4", video: "h264", audio: "aac", transcodingStarted: false },
    budget: {
      estimatedVideoBitsPerSecond: videoRate,
      estimatedAudioBitsPerSecond: audioRate,
      containerOverheadPercent: overheadPercent,
      estimatedDuration90k: durationTotal90k.toString(),
      knownSubtotalBytes: knownSubtotalBytes.toString(),
      estimatedTotalBytes: estimateUnknown ? null : knownSubtotalBytes.toString(),
      estimateBasis: "configured-target-bitrate-assumption",
      status: estimateUnknown ? "unknown" : "estimated",
      ...(estimateUnknown ? { reason: "Reachability or one or more media requirements are unresolved; the subtotal excludes unknown demands." } : {}),
      deduplicationApplied: false,
    },
    requirements,
    capabilityReport,
    diagnostics,
  };

  function planPlayItem(item: PlayItem, playlistId: string, sourceClosure: MediaClosure, videoBitsPerSecond: number, audioBitsPerSecond: number, overhead: number, outputDiagnostics: MediaPlan["diagnostics"]): MediaPlanRequirement["playItems"][number] {
    const clipNode = graphNodes.get(`clip:${item.clipId}`);
    const clipInfoNode = graphNodes.get(`clipInfo:${item.clipId}`);
    const streamFilePath = `BDMV/STREAM/${item.clipId}.m2ts`;
    if (clipNode?.state !== "present") outputDiagnostics.push({ code: "MEDIA_STREAM_FILE_MISSING", message: `Playlist '${playlistId}' PlayItem ${item.index} requires missing STREAM clip '${item.clipId}'.`, source: clipNode?.source ?? item.source });
    if (clipInfoNode?.state !== "present") outputDiagnostics.push({ code: "MEDIA_CLIP_INFO_MISSING", message: `Playlist '${playlistId}' PlayItem ${item.index} has no parsed CLPI for '${item.clipId}'.`, source: clipInfoNode?.source ?? item.source });
    const tracks = item.streams.map(toTrack);
    for (const track of tracks) {
      if (track.pid === null) outputDiagnostics.push({ code: "MEDIA_PID_UNRESOLVED", message: `Playlist '${playlistId}' PlayItem ${item.index} contains a stream declaration without a PID.`, source: track.source });
      if (track.codingType === null) outputDiagnostics.push({ code: "MEDIA_CODING_TYPE_UNKNOWN", message: `Playlist '${playlistId}' PlayItem ${item.index} contains a stream with unknown coding type.`, source: track.source });
    }
    const reasons: string[] = [];
    if (clipNode?.state !== "present") reasons.push("STREAM file is missing.");
    if (clipInfoNode?.state !== "present") reasons.push("CLPI stream metadata is missing.");
    if (item.multiAngle || item.angleCount > 1 || item.seamlessAngle) {
      reasons.push("Multi-angle or seamless-angle playback is not implemented.");
      outputDiagnostics.push({ code: "MEDIA_ANGLE_UNSUPPORTED", message: `Playlist '${playlistId}' PlayItem ${item.index} declares angleCount=${item.angleCount}, multiAngle=${item.multiAngle}, seamlessAngle=${item.seamlessAngle}.`, source: item.source });
    }
    const videoTracks = tracks.filter((track) => track.role === "video");
    const audioTracks = tracks.filter((track) => track.role === "audio");
    if (!videoTracks.length) { reasons.push("No recognized video track is declared."); outputDiagnostics.push({ code: "MEDIA_VIDEO_TRACK_UNRESOLVED", message: `Playlist '${playlistId}' PlayItem ${item.index} has no recognized video coding type.`, source: item.source }); }
    const hasUnclassifiedTrack = tracks.some((track) => track.role === "unknown");
    if (hasUnclassifiedTrack) { reasons.push("At least one declared track has an unclassified role."); outputDiagnostics.push({ code: "MEDIA_TRACK_ROLE_UNCLASSIFIED", message: `Playlist '${playlistId}' PlayItem ${item.index} has a stream whose media role cannot be classified.`, source: item.source }); }
    const sourceDuration45k = item.outTime45k - item.inTime45k;
    const duration90k = BigInt(Math.max(0, sourceDuration45k)) * 2n;
    const validDuration = sourceDuration45k > 0;
    if (!validDuration) { reasons.push("PlayItem has a non-positive source interval."); outputDiagnostics.push({ code: "MEDIA_INVALID_INTERVAL", message: `Playlist '${playlistId}' PlayItem ${item.index} has an invalid IN/OUT interval.`, source: item.source }); }
    const unknownPid = tracks.some((track) => (track.role === "video" || track.role === "audio") && track.pid === null);
    const hasUnimplementedAngle = item.multiAngle || item.angleCount > 1 || item.seamlessAngle;
    const canEstimate = validDuration && videoTracks.length > 0 && !hasUnclassifiedTrack && !unknownPid && !hasUnimplementedAngle;
    const rateBitsPerSecond = canEstimate ? videoBitsPerSecond + audioTracks.length * audioBitsPerSecond : null;
    const bytes = rateBitsPerSecond === null ? null : estimateBytes(duration90k, rateBitsPerSecond, overhead);
    const estimateReason = bytes === null ? hasUnimplementedAngle ? "Angle alternatives are retained but their source demands are not estimated." : "A required interval or stream role/PID is unresolved." : undefined;
    const status = reasons.length === 0 && sourceClosure.complete ? "planned" as const : "partial" as const;
    return {
      index: item.index, clipId: item.clipId, codecId: item.codecId, stcId: item.stcId, source: item.source,
      streamFile: { path: streamFilePath, present: clipNode?.state === "present", source: clipNode?.source ?? null },
      clipInfo: { id: item.clipId, present: clipInfoNode?.state === "present", source: clipInfoNode?.source ?? null },
      sourceIn45k: item.inTime45k, sourceOut45k: item.outTime45k,
      sourceIn90k: (BigInt(item.inTime45k) * 2n).toString(), sourceOut90k: (BigInt(item.outTime45k) * 2n).toString(),
      duration90k: duration90k.toString(), durationSeconds: Number(duration90k) / 90_000,
      connectionCondition: item.connectionCondition, uoMask: item.uoMask, stillMode: item.stillMode, stillTime: item.stillTime,
      angle: { multiAngle: item.multiAngle, angleCount: item.angleCount, differentAudio: item.differentAudio, seamlessAngle: item.seamlessAngle },
      tracks,
      strategy: { grouping: "per-play-item", container: "mp4", video: "h264", audio: "aac", status, reasons },
      estimate: { bytes, rateBitsPerSecond, ...(estimateReason ? { reason: estimateReason } : {}) },
    };
  }
}

function buildCapabilityReport(requirements: MediaPlanRequirement[]): MediaCapabilityReport {
  const occurrences = (predicate: (requirement: MediaPlanRequirement, item: MediaPlanRequirement["playItems"][number]) => boolean) => requirements.flatMap((requirement) => requirement.playItems
    .filter((item) => predicate(requirement, item))
    .map((item) => ({ playlistId: requirement.playlistId, playItemIndex: item.index, source: item.source })));
  const subPathOccurrences = requirements.flatMap((requirement) => requirement.subPaths
    .filter((subPath) => subPath.items.length > 0)
    .map((subPath) => ({ playlistId: requirement.playlistId, playItemIndex: null, source: subPath.source })));
  const declaredSubtitleOccurrences = occurrences((_requirement, item) => item.tracks.some((track) => track.role === "subtitle" || track.role === "unknown"));
  const angleOccurrences = occurrences((_requirement, item) => item.angle.multiAngle || item.angle.angleCount > 1);
  const seamlessOccurrences = occurrences((_requirement, item) => item.angle.seamlessAngle);
  const subtitleMessage = declaredSubtitleOccurrences.length
    ? "Subtitle or unclassified streams are declared, but forced-subtitle semantics are not represented by the inspected M1 model."
    : "Forced-subtitle metadata is not represented by the inspected M1 model; M2 composition data was not inspected, so absence is unknown.";
  return {
    inspectedStages: ["M1"],
    notInspectedStages: ["M2"],
    strictUpgradeAllowed: false,
    impacts: [
      {
        capability: "seamless", status: seamlessOccurrences.length ? "unsupported" : "unknown",
        inspection: seamlessOccurrences.length ? "inspected" : "partially-inspected",
        message: seamlessOccurrences.length
          ? "M1 marks seamless-angle behavior on reachable PlayItems; seamless playback is unsupported."
          : "No seamless-angle flag was observed, but M1 connection-condition semantics are not verified here and M2 was not inspected; seamless requirements remain unknown.",
        affected: seamlessOccurrences,
      },
      {
        capability: "angle", status: angleOccurrences.length ? "unsupported" : "unknown",
        inspection: "inspected",
        message: angleOccurrences.length
          ? "M1 declares multiple angles on reachable PlayItems; angle selection is unsupported."
          : "No multi-angle declaration was observed in inspected M1 PlayItems; this does not establish that all reachable angle behavior is absent.",
        affected: angleOccurrences,
      },
      {
        capability: "pip", status: "unknown", inspection: subPathOccurrences.length ? "partially-inspected" : "not-inspected",
        message: subPathOccurrences.length
          ? "Reachable SubPath declarations are retained, but their presentation role is unverified and cannot be classified as PiP."
          : "M1 has no PiP classification, and M2 was not inspected; PiP presence is unknown.",
        affected: subPathOccurrences,
      },
      {
        capability: "hdr", status: "unknown", inspection: "not-inspected",
        message: "HDR metadata and validated tone-mapping status are not exposed by the inspected M1/M5 inputs; HDR presence is unknown.",
        affected: [],
      },
      {
        capability: "forced-subtitle", status: "unknown", inspection: declaredSubtitleOccurrences.length ? "partially-inspected" : "not-inspected",
        message: subtitleMessage,
        affected: declaredSubtitleOccurrences,
      },
      {
        capability: "textst", status: "unknown", inspection: declaredSubtitleOccurrences.length ? "partially-inspected" : "not-inspected",
        message: "The inspected inputs do not provide verified TextST stream classification; subtitle or unknown stream declarations do not establish TextST presence or absence.",
        affected: declaredSubtitleOccurrences,
      },
    ],
  };
}

function planSubPlayItem(item: SubPlayItem, disc: ParsedDisc): MediaPlanRequirement["subPaths"][number]["items"][number] {
  const streamNode = disc.graph.nodes.find((node) => node.id === `clip:${item.clipId}`);
  const clipInfo = disc.graph.nodes.find((node) => node.id === `clipInfo:${item.clipId}`);
  const tracks = disc.clips.find((clip) => sameId(clip.id, item.clipId))?.programs.flatMap((program) => program.streams.map((stream) => toTrack({ streamType: 1, pid: stream.pid, subPathId: null, subClipId: null, codingType: stream.codingType, language: stream.language, dynamicRangeType: stream.dynamicRangeType, colorSpace: stream.colorSpace, source: stream.source }))) ?? [];
  return { clipId: item.clipId, codecId: item.codecId, stcId: item.stcId, sourceIn45k: item.inTime45k, sourceOut45k: item.outTime45k, syncPlayItemId: item.syncPlayItemId, syncPts45k: item.syncPts45k, source: item.source, streamFile: { path: `BDMV/STREAM/${item.clipId}.m2ts`, present: streamNode?.state === "present", source: streamNode?.source ?? null }, clipInfo: { id: item.clipId, present: clipInfo?.state === "present", source: clipInfo?.source ?? null }, tracks };
}

function toTrack(stream: StreamDeclaration): PlannedTrack {
  const type = stream.codingType;
  const role = type === null ? "unknown" : VIDEO_CODING_TYPES.has(type) ? "video" : AUDIO_CODING_TYPES.has(type) ? "audio" : SUBTITLE_CODING_TYPES.has(type) ? "subtitle" : "unknown";
  return { role, streamType: stream.streamType, codingType: type, pid: stream.pid, subPathId: stream.subPathId, subClipId: stream.subClipId, language: stream.language, source: stream.source };
}
