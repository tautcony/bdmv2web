import { errorText } from "@bdmv2web/utils";

/**
 * Publish every item of one async sequence to several consumers.
 *
 * Backpressure: each consumer holds at most `QUEUE_LIMIT` items, so a consumer
 * that writes to disk can run a little behind the one that only parses, while
 * the bounded queues keep the producer from reading a whole clip into memory.
 * A consumer that stops early (throw or early return) is detached, so the other
 * consumers keep receiving items. A read failure is rethrown by every consumer
 * that is still open.
 *
 * `readToEnd` keeps the producer draining the source after every consumer has
 * left. A producer that owns diagnostics (the shared packet scan) needs EOF to
 * report trailing damage; `done` resolves when that drain finishes.
 */
const QUEUE_LIMIT = 2;

export interface FanOut<T> {
  readonly streams: AsyncIterable<T>[];
  /** Resolves when the producer has reached the end of the source. */
  readonly done: Promise<void>;
}

export function fanOutWithDone<T>(source: AsyncIterable<T>, consumers: number, options: { readToEnd?: boolean } = {}): FanOut<T> {
  if (!Number.isInteger(consumers) || consumers <= 0) throw new RangeError("consumers must be a positive integer");
  const readToEnd = options.readToEnd === true;
  const states = Array.from({ length: consumers }, () => ({ queue: [] as T[], closed: false }));
  let version = 0;
  let waiting: Array<() => void> = [];
  let failure: unknown = null;
  let finished = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });

  const changed = (): void => {
    version++;
    const pending = waiting;
    waiting = [];
    for (const resolve of pending) resolve();
  };
  const waitForChange = (seen: number): Promise<void> => (version === seen ? new Promise<void>((resolve) => { waiting.push(resolve); }) : Promise.resolve());

  const drain = async (): Promise<void> => {
    let seen = version;
    while (states.some((state) => !state.closed && state.queue.length >= QUEUE_LIMIT)) {
      await waitForChange(seen);
      seen = version;
    }
  };

  const pump = async (): Promise<void> => {
    try {
      for await (const item of source) {
        for (const state of states) if (!state.closed) state.queue.push(item);
        changed();
        await drain();
        if (!readToEnd && states.every((state) => state.closed)) return;
      }
    } catch (error) {
      failure = error;
    } finally {
      finished = true;
      changed();
      resolveDone();
    }
  };
  void pump();

  const stream = (index: number): AsyncIterable<T> => ({
    async *[Symbol.asyncIterator](): AsyncGenerator<T> {
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
          const item = state.queue.shift()!;
          // Every take can free a slot under the high-water mark, not only the
          // one that empties the queue.
          changed();
          yield item;
        }
      } finally {
        state.closed = true;
        state.queue.length = 0;
        changed();
      }
    },
  });
  return { streams: states.map((_, index) => stream(index)), done };
}

export function fanOut<T>(source: AsyncIterable<T>, consumers: number): AsyncIterable<T>[] {
  return fanOutWithDone(source, consumers).streams;
}

/** Read one byte stream once and publish every chunk to several consumers. */
export function fanOutChunks(source: AsyncIterable<Uint8Array>, consumers: number): AsyncIterable<Uint8Array>[] {
  return fanOut(source, consumers);
}
