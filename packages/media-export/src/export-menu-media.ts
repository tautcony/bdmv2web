import { resolve } from "node:path";
import { resolveEncodingDefaults } from "./encoding-defaults.js";
import { exportMenuLoopMedia } from "./menu-loop-export.js";
import { menuMediaPaths, priorMenuMediaPaths } from "./menu-media-layout.js";
import type { MediaAssetProgress, MediaProcessResult, MediaProcessRunner, MenuLoopMediaInput, MenuLoopMediaResult, MenuMediaEncoding } from "./media-types.js";

/** Media encoded ahead of package assembly. */
export interface PreparedMenuMedia {
  primary?: { input: MenuLoopMediaInput; result: MenuLoopMediaResult; planPath: string };
  additional: Array<{ input: MenuLoopMediaInput; result: MenuLoopMediaResult; planPath: string }>;
}

export interface ExportMenuMediaOptions {
  outputDirectory: string;
  mediaEncoding?: MenuMediaEncoding;
  reuseFromDirectory?: string;
  runProcess?: MediaProcessRunner;
  onProgress?: (progress: MediaAssetProgress) => void;
}

/**
 * Encode every menu media unit, in order, and return the prepared results.
 * The result carries encoded media and plans; `assembleMenuPackage()` writes
 * the package files.
 */
export async function exportMenuMedia(
  primaryInput: MenuLoopMediaInput | undefined,
  additionalInputs: readonly MenuLoopMediaInput[],
  options: ExportMenuMediaOptions,
): Promise<PreparedMenuMedia> {
  const mediaEncoding = options.mediaEncoding ?? {};
  const sourceProbeCache = new Map<string, Promise<MediaProcessResult>>();
  const shared = {
    outputDirectory: options.outputDirectory,
    ...mediaEncoding,
    sourceProbeCache,
    ...(options.reuseFromDirectory ? { reuseFromDirectory: options.reuseFromDirectory } : {}),
    ...(options.runProcess ? { runProcess: options.runProcess } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  };
  const primaryMedia = primaryInput === undefined ? undefined : menuMediaPaths(primaryInput);
  const primaryResult = primaryInput && primaryMedia
    ? await exportMenuLoopMedia(primaryInput, {
      ...shared,
      assetDirectory: primaryMedia.directory,
      planPath: primaryMedia.planPath,
      ...(options.reuseFromDirectory ? { reuseAlternatives: priorMenuMediaPaths(primaryInput) } : {}),
    })
    : undefined;

  const mediaByKey = new Map<string, { result: MenuLoopMediaResult; planPath: string }>();
  if (primaryInput && primaryResult && primaryMedia) mediaByKey.set(menuMediaReuseKey(primaryInput, mediaEncoding), { result: primaryResult, planPath: primaryMedia.planPath });
  const additional: PreparedMenuMedia["additional"] = [];
  for (const media of additionalInputs) {
    const key = menuMediaReuseKey(media, mediaEncoding);
    const existing = mediaByKey.get(key);
    if (existing) {
      // The PlayItem shares its bytes with one already exported, so it also
      // shares that unit's plan file: `media-plans/` holds one plan per encoded
      // unit, and each PlayItem references the unit's plan.
      options.onProgress?.({ state: "end", outTimeSeconds: existing.result.background.durationSeconds, durationSeconds: existing.result.background.durationSeconds, assetPath: existing.result.background.path, source: { playlistId: media.playlistId, playItemIndex: media.playItemIndex, clipId: media.clipId, kind: "background", pid: media.videoPid, videoMode: existing.result.plan.encoding.video.mode, reused: true } });
      additional.push({ input: media, result: referenceMenuMediaResult(existing.result, media), planPath: existing.planPath });
      continue;
    }
    const { directory, planPath } = menuMediaPaths(media);
    const result = await exportMenuLoopMedia(media, {
      ...shared,
      assetDirectory: directory,
      planPath,
      ...(options.reuseFromDirectory ? { reuseAlternatives: priorMenuMediaPaths(media) } : {}),
    });
    additional.push({ input: media, result, planPath });
    mediaByKey.set(key, { result, planPath });
  }
  return {
    ...(primaryInput && primaryResult && primaryMedia ? { primary: { input: primaryInput, result: primaryResult, planPath: primaryMedia.planPath } } : {}),
    additional,
  };
}

function menuMediaReuseKey(media: MenuLoopMediaInput, encoding: MenuMediaEncoding): string {
  const defaults = resolveEncodingDefaults(encoding);
  return JSON.stringify({
    sourcePath: resolve(media.sourcePath),
    sourceFile: media.sourceFile,
    clipId: media.clipId,
    inTime45k: media.inTime45k,
    loopStart45k: media.loopStart45k ?? null,
    includeIntro: media.includeIntro ?? false,
    outTime45k: media.outTime45k,
    stillMode: media.stillMode,
    repeatCount: media.repeatCount,
    loopBackground: media.loopBackground ?? (media.stillMode !== 2 && media.repeatCount > 1),
    videoPid: media.videoPid,
    audioTracks: media.audioTracks.map(({ streamNumber, pid, language }) => [streamNumber, pid, language]),
    encoding: {
      codec: defaults.codec,
      crf: defaults.crf,
      preset: defaults.preset,
      hdrMode: defaults.hdrMode,
      videoMode: defaults.videoMode,
    },
  });
}

/** Record a PlayItem that names media already exported for another one. */
function referenceMenuMediaResult(media: MenuLoopMediaResult, input: MenuLoopMediaInput): MenuLoopMediaResult {
  return {
    ...media,
    plan: {
      ...media.plan,
      playlistId: input.playlistId,
      playItemIndex: input.playItemIndex,
      assetPaths: { background: media.background.path, audioTracks: media.audioTracks.map((track) => track.path) },
    },
    tools: { ffmpeg: "reused", ffprobe: "reused", invocations: [] },
    files: [],
  };
}
