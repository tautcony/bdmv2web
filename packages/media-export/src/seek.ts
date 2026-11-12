import { errorText } from "@bdmv2web/utils";
import { MediaTimelineMap, type MediaTimelinePosition } from "./timeline.js";

export const MEDIA_HAVE_METADATA = 1;
export const MEDIA_HAVE_CURRENT_DATA = 2;

export interface SeekMediaElement {
  currentTime: number;
  duration: number;
  readyState: number;
  addEventListener(type: string, listener: (event?: unknown) => void, options?: { once?: boolean }): void;
  removeEventListener(type: string, listener: (event?: unknown) => void): void;
}

export interface SeekTimelineRequest {
  timeline: MediaTimelineMap;
  playlistId: string;
  playlistTime90k: string;
  media: SeekMediaElement;
  generation: number;
  isCurrent(generation: number): boolean;
  /** Target video frame duration measured from the selected output video stream. */
  targetFrameDuration90k: string;
  timeoutMs?: number;
}

export type TimelineSeekResult =
  | { status: "completed"; generation: number; position: MediaTimelinePosition; requestedSeconds: number; actualSeconds: number; errorSeconds: number; toleranceSeconds: number }
  | { status: "failed"; generation: number; reason: string; position?: MediaTimelinePosition; requestedSeconds?: number; actualSeconds?: number; errorSeconds?: number; toleranceSeconds?: number }
  | { status: "stale"; generation: number; reason: string };

/**
 * Seek to one playlist position and report completion only after metadata,
 * seeked, decoded current data and one-frame accuracy are all established.
 */
export async function seekTimeline(request: SeekTimelineRequest): Promise<TimelineSeekResult> {
  const timeoutMs = request.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(request.generation) || request.generation < 0) throw new RangeError("generation must be a non-negative safe integer.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RangeError("timeoutMs must be a positive safe integer.");
  const frameTicks = parsePositiveTicks(request.targetFrameDuration90k);
  const toleranceSeconds = Number(frameTicks) / 90_000;
  if (!Number.isFinite(toleranceSeconds) || toleranceSeconds <= 0) throw new RangeError("targetFrameDuration90k is outside the supported numeric range.");
  const position = request.timeline.playlistToSource(request.playlistId, request.playlistTime90k);
  if (!position) return { status: "failed", generation: request.generation, reason: "The playlist timestamp is outside every mapped PlayItem." };
  const requestedSeconds = Number(BigInt(position.mediaTime90k)) / 90_000;
  if (!Number.isFinite(requestedSeconds) || requestedSeconds < 0) return { status: "failed", generation: request.generation, reason: "Mapped media time cannot be represented as a finite HTML media timestamp.", position };
  if (!request.isCurrent(request.generation)) return { status: "stale", generation: request.generation, reason: "The seek generation is no longer current." };

  if (request.media.readyState < MEDIA_HAVE_METADATA) {
    const metadata = await waitForMediaEvent(request.media, "loadedmetadata", timeoutMs).promise;
    if (!metadata.ok) return { status: "failed", generation: request.generation, reason: metadata.reason, position, requestedSeconds, toleranceSeconds };
    if (!request.isCurrent(request.generation)) return { status: "stale", generation: request.generation, reason: "The seek generation changed before metadata became available." };
  }
  if (!Number.isFinite(request.media.duration) || request.media.duration <= 0 || requestedSeconds > request.media.duration) {
    return { status: "failed", generation: request.generation, reason: "Mapped media time is outside the loaded asset duration.", position, requestedSeconds, toleranceSeconds };
  }

  if (request.media.readyState >= MEDIA_HAVE_CURRENT_DATA) {
    const alreadyAtTarget = validatePosition(request, position, requestedSeconds, frameTicks, toleranceSeconds);
    if (alreadyAtTarget.status === "completed") return alreadyAtTarget;
  }

  const seekedWait = waitForMediaEvent(request.media, "seeked", timeoutMs);
  try {
    request.media.currentTime = requestedSeconds;
  } catch (error) {
    seekedWait.cancel("Setting currentTime failed.");
    return { status: "failed", generation: request.generation, reason: `Setting currentTime failed: ${errorText(error)}`, position, requestedSeconds, toleranceSeconds };
  }
  const seeked = await seekedWait.promise;
  if (!seeked.ok) return { status: "failed", generation: request.generation, reason: seeked.reason, position, requestedSeconds, toleranceSeconds };
  if (!request.isCurrent(request.generation)) return { status: "stale", generation: request.generation, reason: "A seeked response arrived for an obsolete generation." };
  if (request.media.readyState < MEDIA_HAVE_CURRENT_DATA) {
    const decoded = await waitForMediaReadyState(request.media, MEDIA_HAVE_CURRENT_DATA, timeoutMs);
    if (!decoded.ok) return { status: "failed", generation: request.generation, reason: decoded.reason, position, requestedSeconds, actualSeconds: request.media.currentTime, toleranceSeconds };
    if (!request.isCurrent(request.generation)) return { status: "stale", generation: request.generation, reason: "A decoded-frame response arrived for an obsolete generation." };
  }
  return validatePosition(request, position, requestedSeconds, frameTicks, toleranceSeconds);
}

function validatePosition(request: SeekTimelineRequest, position: MediaTimelinePosition, requestedSeconds: number, frameTicks: bigint, toleranceSeconds: number): TimelineSeekResult {
  const actualSeconds = request.media.currentTime;
  if (!Number.isFinite(actualSeconds) || actualSeconds < 0) return { status: "failed", generation: request.generation, reason: "The media element reported an invalid currentTime after seeked.", position, requestedSeconds, actualSeconds, toleranceSeconds };
  const actualTicks = BigInt(Math.round(actualSeconds * 90_000));
  const requestedTicks = BigInt(position.mediaTime90k);
  const errorTicks = actualTicks >= requestedTicks ? actualTicks - requestedTicks : requestedTicks - actualTicks;
  const errorSeconds = Number(errorTicks) / 90_000;
  if (errorTicks > frameTicks) return { status: "failed", generation: request.generation, reason: "The completed seek is more than one target-video frame from the requested position.", position, requestedSeconds, actualSeconds, errorSeconds, toleranceSeconds };
  return { status: "completed", generation: request.generation, position, requestedSeconds, actualSeconds, errorSeconds, toleranceSeconds };
}

type WaitResult = { ok: true } | { ok: false; reason: string };
interface MediaEventWait { promise: Promise<WaitResult>; cancel(reason: string): void; }

function waitForMediaReadyState(media: SeekMediaElement, readyState: number, timeoutMs: number): Promise<WaitResult> {
  if (media.readyState >= readyState) return Promise.resolve({ ok: true });
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      media.removeEventListener("loadeddata", onData);
      media.removeEventListener("canplay", onData);
      media.removeEventListener("error", onError);
      media.removeEventListener("abort", onAbort);
    };
    const finish = (result: WaitResult) => { if (!settled) { settled = true; cleanup(); resolve(result); } };
    const onData = () => { if (media.readyState >= readyState) finish({ ok: true }); };
    const onError = () => finish({ ok: false, reason: "Media error occurred while waiting for decoded current-frame data." });
    const onAbort = () => finish({ ok: false, reason: "Media loading or seeking was aborted while waiting for decoded current-frame data." });
    const timer = setTimeout(() => finish({ ok: false, reason: "Timed out waiting for decoded current-frame data." }), timeoutMs);
    media.addEventListener("loadeddata", onData);
    media.addEventListener("canplay", onData);
    media.addEventListener("error", onError);
    media.addEventListener("abort", onAbort);
  });
}

function waitForMediaEvent(media: SeekMediaElement, eventName: string, timeoutMs: number): MediaEventWait {
  let cancel = (_reason: string) => {};
  const promise = new Promise<WaitResult>((resolve) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      media.removeEventListener(eventName, onReady);
      media.removeEventListener("error", onError);
      media.removeEventListener("abort", onAbort);
    };
    const finish = (result: WaitResult) => { if (!settled) { settled = true; cleanup(); resolve(result); } };
    cancel = (reason) => finish({ ok: false, reason });
    const onReady = () => finish({ ok: true });
    const onError = () => finish({ ok: false, reason: `Media error occurred before ${eventName}.` });
    const onAbort = () => finish({ ok: false, reason: `Media loading or seeking was aborted before ${eventName}.` });
    const timer = setTimeout(() => finish({ ok: false, reason: `Timed out waiting for ${eventName}.` }), timeoutMs);
    media.addEventListener(eventName, onReady, { once: true });
    media.addEventListener("error", onError, { once: true });
    media.addEventListener("abort", onAbort, { once: true });
  });
  return { promise, cancel: (reason) => cancel(reason) };
}

function parsePositiveTicks(value: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value)) throw new TypeError("targetFrameDuration90k must be a canonical positive integer string.");
  return BigInt(value);
}
