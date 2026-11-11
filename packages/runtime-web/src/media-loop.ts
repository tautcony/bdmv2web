export interface LoopingMediaElement {
  currentTime: number;
  readonly src?: string;
  play(): Promise<void> | void;
}

/** Resume a menu video and its selected audio lane from the same loop mark. */
export async function replayMediaAtLoopPoint(video: LoopingMediaElement, audio: LoopingMediaElement | null, loopStartSeconds: number): Promise<void> {
  await Promise.all([replayOneMediaAtLoopPoint(video, loopStartSeconds), ...(audio && audio.src ? [replayOneMediaAtLoopPoint(audio, loopStartSeconds)] : [])]);
}

export async function replayOneMediaAtLoopPoint(media: LoopingMediaElement, loopStartSeconds: number): Promise<void> {
  if (!Number.isFinite(loopStartSeconds) || loopStartSeconds < 0) throw new RangeError("loopStartSeconds must be a finite non-negative number");
  media.currentTime = loopStartSeconds;
  await Promise.resolve(media.play());
}
