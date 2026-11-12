export async function runMonitoredProcess<T>(options: {
  run: (signal: AbortSignal) => Promise<T>;
  check: (phase: "during encoding" | "at process completion") => Promise<void>;
  signal?: AbortSignal;
  cancellationError?: () => Error;
  monitorError: (error: unknown) => Error;
}): Promise<T> {
  const controller = new AbortController();
  const process = options.run(controller.signal);
  let checking = false;
  let rejectMonitor: (error: Error) => void = () => {};
  const failure = new Promise<never>((_resolve, reject) => { rejectMonitor = reject; });
  const check = async () => {
    if (checking) return;
    checking = true;
    try { await options.check("during encoding"); }
    catch (error) { rejectMonitor(options.monitorError(error)); controller.abort(); }
    finally { checking = false; }
  };
  const timer = setInterval(() => { void check(); }, 10);
  void check();
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    if (!options.signal || !options.cancellationError) return;
    onAbort = () => { reject(options.cancellationError!()); controller.abort(); };
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const result = await Promise.race([process, failure, cancelled]);
    await options.check("at process completion");
    return result;
  } catch (error) {
    controller.abort();
    await process.catch(() => undefined);
    throw error;
  } finally {
    clearInterval(timer);
    if (onAbort) options.signal?.removeEventListener("abort", onAbort);
  }
}

export async function runControlledProcess<T>(options: {
  run: (signal: AbortSignal) => Promise<T>;
  signals: readonly (AbortSignal | undefined)[];
  timeoutMs: number;
  cancellationError: () => Error;
  timeoutError: () => Error;
  processError: (error: unknown, cancelled: boolean) => Error;
}): Promise<T> {
  const controller = new AbortController();
  let cancelled = false;
  let rejectCancelled: (error: Error) => void = () => {};
  const cancellation = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
  const abort = () => { cancelled = true; rejectCancelled(options.cancellationError()); controller.abort(); };
  for (const signal of options.signals) signal?.addEventListener("abort", abort, { once: true });
  let rejectTimeout: (error: Error) => void = () => {};
  const deadline = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
  const process = options.run(controller.signal);
  const timer = setTimeout(() => { rejectTimeout(options.timeoutError()); controller.abort(); }, options.timeoutMs);
  try { return await Promise.race([process, deadline, cancellation]); }
  catch (error) {
    controller.abort();
    await process.catch(() => undefined);
    throw options.processError(error, cancelled);
  } finally {
    clearTimeout(timer);
    for (const signal of options.signals) signal?.removeEventListener("abort", abort);
  }
}
