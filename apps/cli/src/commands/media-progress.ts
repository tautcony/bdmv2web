import type { MediaAssetProgress, MenuLoopMediaInput } from "@bdmv2web/media-export";

export interface MediaExportProgress {
  readonly clips: number;
  readonly onMediaProgress: (progress: MediaAssetProgress) => void;
}

export function mediaExportProgress(
  media: readonly MenuLoopMediaInput[],
  report: (ratio: number, detail: string) => void,
): MediaExportProgress {
  const planned = new Map<string, number>();
  for (const item of media) {
    const key = clipKey(item.playlistId, item.playItemIndex);
    if (!planned.has(key)) planned.set(key, planned.size + 1);
  }
  let currentKey: string | undefined;
  let finishedClips = 0;
  let clipRatio = 0;
  return {
    clips: planned.size,
    onMediaProgress: (progress) => {
      const key = clipKey(progress.source.playlistId, progress.source.playItemIndex);
      if (key !== currentKey) {
        if (currentKey !== undefined && planned.has(currentKey)) finishedClips += 1;
        currentKey = key;
        clipRatio = 0;
      }
      clipRatio = Math.max(clipRatio, clipRatioOf(progress));
      const ratio = planned.size > 0 ? Math.min(1, (finishedClips + clipRatio) / planned.size) : 0;
      report(ratio, detailOf(progress, planned.get(key), planned.size));
    },
  };
}

/** A clip is still running until its process ends, so 0.99 stays short of a finished clip. */
function clipRatioOf(progress: MediaAssetProgress): number {
  if (progress.state === "end") return 1;
  if (progress.durationSeconds <= 0) return 0;
  return Math.min(0.99, progress.outTimeSeconds / progress.durationSeconds);
}

function detailOf(progress: MediaAssetProgress, position: number | undefined, clips: number): string {
  const clipFile = `${progress.source.clipId}.m2ts`;
  const label = position !== undefined && clips > 1
    ? `clip ${position}/${clips} · ${clipFile}`
    : `clip ${clipFile}`;
  if (progress.source.reused === true) return `${label} · reused`;
  const pipeline = progress.source.videoMode === undefined ? "background" : `background ${progress.source.videoMode}`;
  const encoded = Math.min(progress.outTimeSeconds, progress.durationSeconds);
  return `${label} · ${pipeline} ${encoded.toFixed(1)}/${progress.durationSeconds.toFixed(1)}s`;
}

function clipKey(playlistId: string, playItemIndex: number): string {
  return `${playlistId}-${playItemIndex}`;
}
