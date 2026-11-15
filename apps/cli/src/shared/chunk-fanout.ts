import { errorText } from "@bdmv2web/utils";

/**
 * Read one byte stream once and publish every chunk to several consumers.
 *
 * `export` needs the same clip bytes twice: IGS extraction assembles display
 * sets, PGS extraction rewrites subtitle PES into SUP. Both need only a
 * sequential view of the file, so one file read feeds both consumers.
 *
 * Backpressure: the producer waits until every live consumer has taken the
 * chunk it just published, so each consumer holds at most one chunk. A consumer
 * that stops early (throw or early return) is detached instead of blocking the
 * others, and a read failure is rethrown by every consumer that is still open.
 */
export function fanOutChunks(source: AsyncIterable<Uint8Array>, consumers: number): AsyncIterable<Uint8Array>[] {
  if (!Number.isInteger(consumers) || consumers <= 0) throw new RangeError("consumers must be a positive integer");
  const states = Array.from({ length: consumers }, () => ({ queue: [] as Uint8Array[], closed: false }));
  let version = 0;
  let waiting: Array<() => void> = [];
  let failure: unknown = null;
  let finished = false;

  const changed = (): void => {
    version++;
    const pending = waiting;
    waiting = [];
    for (const resolve of pending) resolve();
  };
  const waitForChange = (seen: number): Promise<void> => (version === seen ? new Promise<void>((resolve) => { waiting.push(resolve); }) : Promise.resolve());

  const drain = async (): Promise<void> => {
    let seen = version;
    while (!states.every((state) => state.closed || state.queue.length === 0)) {
      await waitForChange(seen);
      seen = version;
    }
  };

  const pump = async (): Promise<void> => {
    try {
      for await (const chunk of source) {
        for (const state of states) if (!state.closed) state.queue.push(chunk);
        changed();
        await drain();
        if (states.every((state) => state.closed)) return;
      }
    } catch (error) {
      failure = error;
    } finally {
      finished = true;
      changed();
    }
  };
  void pump();

  const stream = (index: number): AsyncIterable<Uint8Array> => ({
    async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
      const state = states[index]!;
      try {
        for (;;) {
          if (state.queue.length === 0) {
            if (finished) {
              if (failure) throw failure instanceof Error ? failure : new Error(errorText(failure));
              return;
            }
            await waitForChange(version);
            continue;
          }
          const chunk = state.queue.shift()!;
          if (state.queue.length === 0) changed();
          yield chunk;
        }
      } finally {
        state.closed = true;
        state.queue.length = 0;
        changed();
      }
    },
  });
  return states.map((_, index) => stream(index));
}
