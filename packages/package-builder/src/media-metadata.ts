import type { exportMenuLoopMedia } from "@bdmv2web/media-export";


export function runtimeAudioTrackMetadata(track: { streamNumber?: number; path: string; language: string; durationSeconds?: number }): { streamNumber: number; psrStreamNumber: number; path: string; language: string; durationSeconds?: number } {
  if (!Number.isSafeInteger(track.streamNumber) || track.streamNumber! < 0) throw new TypeError("Exported audio track requires its zero-based STN streamNumber.");
  return { streamNumber: track.streamNumber!, psrStreamNumber: track.streamNumber! + 1, path: track.path, language: track.language, ...(track.durationSeconds === undefined ? {} : { durationSeconds: track.durationSeconds }) };
}


export function packagedMediaMetadata(media: Awaited<ReturnType<typeof exportMenuLoopMedia>>): Record<string, unknown> {
  return {
    plan: media.plan,
    outputSize: media.outputSize,
    background: { path: media.background.path, byteLength: media.background.byteLength, codec: media.background.codec, pid: media.background.pid, width: media.background.width, height: media.background.height, durationSeconds: media.background.durationSeconds, loop: media.background.loop, ...(media.background.loopStartSeconds === undefined ? {} : { loopStartSeconds: media.background.loopStartSeconds }) },
    audioTracks: media.audioTracks.map((track) => ({ ...runtimeAudioTrackMetadata(track), byteLength: track.byteLength, codec: track.codec, pid: track.pid, durationSeconds: track.durationSeconds })),
  };
}
