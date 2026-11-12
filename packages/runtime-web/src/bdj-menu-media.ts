import type { BdjMenuMediaEvent } from "./bdj-runtime.js";
import { replayMediaAtLoopPoint, replayOneMediaAtLoopPoint } from "./media-loop.js";

export interface BdjMenuMediaHandle { retry(): void; stop(): void }

/** Play prepared menu items in sequence and report browser-observed media events. */
export function startBdjMenuMedia(
  event: BdjMenuMediaEvent,
  video: HTMLVideoElement,
  audio: HTMLAudioElement | null,
  sendEvent: (playerId: string, event: "started" | "presented" | "ended" | "error" | "blocked" | "stopped" | `missing-ended|${number}|${string}` | `position|${string}|${number}|${string}`) => void,
  onMessage: (message: string, error?: boolean) => void,
): BdjMenuMediaHandle | undefined {
  if (!event.items.length) { sendEvent(event.playerId, "error"); return undefined; }
  let itemIndex = 0;
  let started = false;
  let blocked = false;
  let stopped = false;
  let presented = false;
  let activeItemStarted = false;
  let lastSkipped: BdjMenuMediaEvent["items"][number] | undefined;
  let emittedMarks = new Set<number>();
  let lastPosition90k = -1n;
  const listeners = new AbortController();
  const loopOffset = (item: BdjMenuMediaEvent["items"][number]): number | null => item.loopStartOffset90k === undefined ? null : Number(item.loopStartOffset90k) / 90_000;
  const resumeLoop = (item: BdjMenuMediaEvent["items"][number]): void => {
    const offset = loopOffset(item);
    if (offset === null) return;
    void replayMediaAtLoopPoint(video, audio, offset).then(() => {
      if (stopped) return;
      const position90k = BigInt(item.mediaStart90k ?? item.start90k) + BigInt(Math.floor(offset * 90_000));
      for (const mark of item.marks ?? []) if (BigInt(mark.offset90k) >= BigInt(Math.floor(offset * 90_000))) emittedMarks.delete(mark.index);
      if (item.loopMarkIndex !== undefined) emittedMarks.add(item.loopMarkIndex);
      lastPosition90k = position90k;
      sendEvent(event.playerId, `position|${(position90k * 1_000_000_000n / 90_000n).toString()}|${item.index}|${item.loopMarkIndex ?? ""}`);
    }).catch((error: unknown) => {
      if (stopped) return;
      stopped = true; listeners.abort(); sendEvent(event.playerId, "error");
      onMessage(`BD-J menu loop could not resume: ${error instanceof Error ? error.message : String(error)}`, true);
    });
  };
  const clearMedia = (): void => {
    activeItemStarted = false;
    video.pause(); video.removeAttribute("src"); video.load();
    if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
  };
  const currentSourceMatches = (): boolean => {
    const item = event.items[itemIndex];
    if (!item?.url) return false;
    const expected = new URL(item.url, document.baseURI).href;
    return !video.currentSrc || video.currentSrc === expected;
  };
  const playCurrent = (): void => {
    while (!stopped) {
      const item = event.items[itemIndex];
      if (!item) {
        stopped = true; listeners.abort(); clearMedia();
        if (lastSkipped) sendEvent(event.playerId, `missing-ended|${lastSkipped.index}|${encodeURIComponent(lastSkipped.source.path)}`);
        else sendEvent(event.playerId, "ended");
        return;
      }
      if (item.missing || !item.url) {
        clearMedia();
        lastSkipped = item;
        onMessage(item.warning ?? `BD-J media is unavailable: BDJO ${event.bdjoId}, title ${event.title}, playlist ${event.playlistId}, PlayItem ${item.index}, source STREAM/${item.clipId}.m2ts. Skipping this item.`);
        if (stopped) return;
        itemIndex += 1;
        continue;
      }
      video.src = new URL(item.url, document.baseURI).href;
      activeItemStarted = false;
      emittedMarks = new Set(); lastPosition90k = -1n;
      video.load();
      if (audio) {
        audio.pause();
        audio.src = item.audioUrls?.[0] ? new URL(item.audioUrls[0], document.baseURI).href : "";
        audio.load();
        if (audio.src) void audio.play().catch((error: unknown) => {
          if (!stopped) onMessage(`BD-J menu audio could not play: ${error instanceof Error ? error.message : String(error)}`, true);
        });
      }
      void video.play().catch((error: unknown) => {
        if (stopped) return;
        if (!currentSourceMatches()) return;
        const isBlocked = error instanceof Error && error.name === "NotAllowedError";
        blocked = isBlocked;
        sendEvent(event.playerId, isBlocked ? "blocked" : "error");
        onMessage(isBlocked
          ? `BD-J menu media playlist ${event.playlistId} is ready. Press a menu key or click the scene to play it.`
          : `BD-J menu media playlist ${event.playlistId} could not play: ${error instanceof Error ? error.message : String(error)}`,
          !isBlocked);
        if (!isBlocked) { stopped = true; listeners.abort(); clearMedia(); }
      });
      return;
    }
  };
  video.addEventListener("playing", () => {
    if (stopped || !currentSourceMatches()) return;
    activeItemStarted = true;
    blocked = false;
    if (!started) { started = true; sendEvent(event.playerId, "started"); }
    if (!presented) { presented = true; sendEvent(event.playerId, "presented"); }
  }, { signal: listeners.signal });
  video.addEventListener("timeupdate", () => {
    if (stopped || !activeItemStarted || !currentSourceMatches()) return;
    const item = event.items[itemIndex]; if (!item) return;
    const position90k = BigInt(item.mediaStart90k ?? item.start90k) + BigInt(Math.max(0, Math.floor(video.currentTime * 90_000)));
    if (lastPosition90k >= 0n && position90k < lastPosition90k) for (const mark of item.marks ?? []) if (BigInt(mark.offset90k) >= position90k - BigInt(item.mediaStart90k ?? item.start90k)) emittedMarks.delete(mark.index);
    const crossed = (item.marks ?? []).filter((mark) => !emittedMarks.has(mark.index) && position90k >= BigInt(item.mediaStart90k ?? item.start90k) + BigInt(mark.offset90k)).sort((a, b) => Number(BigInt(a.offset90k) - BigInt(b.offset90k)));
    for (const mark of crossed) {
      emittedMarks.add(mark.index);
      sendEvent(event.playerId, `position|${(position90k * 1_000_000_000n / 90_000n).toString()}|${item.index}|${mark.index}`);
    }
    if (!crossed.length) sendEvent(event.playerId, `position|${(position90k * 1_000_000_000n / 90_000n).toString()}|${item.index}|`);
    lastPosition90k = position90k;
  }, { signal: listeners.signal });
  video.addEventListener("ended", () => {
    if (stopped || !activeItemStarted || !currentSourceMatches()) return;
    const item = event.items[itemIndex];
    if (item && loopOffset(item) !== null) { resumeLoop(item); return; }
    activeItemStarted = false;
    itemIndex += 1;
    playCurrent();
  }, { signal: listeners.signal });
  audio?.addEventListener("ended", () => {
    if (stopped || !audio?.src || !activeItemStarted) return;
    const item = event.items[itemIndex];
    if (!item || loopOffset(item) === null) return;
    const offset = loopOffset(item)!;
    void replayOneMediaAtLoopPoint(audio, offset).catch((error: unknown) => {
      if (!stopped) onMessage(`BD-J menu audio loop could not resume: ${error instanceof Error ? error.message : String(error)}`, true);
    });
  }, { signal: listeners.signal });
  video.addEventListener("error", () => {
    if (stopped || !currentSourceMatches()) return;
    stopped = true; listeners.abort(); video.pause(); video.removeAttribute("src"); video.load(); if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); } sendEvent(event.playerId, "error");
  }, { signal: listeners.signal });
  playCurrent();
  if (stopped) return undefined;
  return {
    retry: () => { if (!stopped && blocked) { blocked = false; void video.play().catch(() => { blocked = true; }); } },
    stop: () => {
      if (stopped) return;
      stopped = true;
      listeners.abort();
      clearMedia();
      if (video.paused) sendEvent(event.playerId, "stopped");
    },
  };
}
