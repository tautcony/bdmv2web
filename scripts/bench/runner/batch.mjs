/**
 * Batched timing for operations shorter than the sample target.
 *
 * One timing sample is `callsPerSample` sequential calls divided by that
 * count, so every recorded value stays milliseconds per call while the
 * measured interval stays above timer quantization.
 */

export const DEFAULT_BATCH_TARGET_MS = 1;
export const DEFAULT_BATCH_WARMUP_MS = 50;
export const MAX_CALLS_PER_SAMPLE = 10_000;

export function callsPerSample(perCallMs, targetMs = DEFAULT_BATCH_TARGET_MS, max = MAX_CALLS_PER_SAMPLE) {
  if (!Number.isFinite(perCallMs) || perCallMs <= 0) return max;
  return Math.min(max, Math.max(1, Math.ceil(targetMs / perCallMs)));
}

async function timeCalls(run, count, now) {
  const started = now();
  for (let index = 0; index < count; index += 1) await run();
  return now() - started;
}

async function warmCalls(run, durationMs, now) {
  const started = now();
  do { await run(); } while (now() - started < durationMs);
}

/**
 * Warms the operation for `warmupMs`, times one call, then times the
 * estimated call count and returns the count that brings one sample to
 * `targetMs`. Warmth matters because an unoptimized first call can cost an
 * order of magnitude more than the steady state. Operations already at or
 * above the target run once.
 */
export async function calibrateCallsPerSample(run, { targetMs = DEFAULT_BATCH_TARGET_MS, warmupMs = DEFAULT_BATCH_WARMUP_MS, max = MAX_CALLS_PER_SAMPLE, now = () => performance.now() } = {}) {
  if (warmupMs > 0) await warmCalls(run, warmupMs, now);
  const first = await timeCalls(run, 1, now);
  if (first >= targetMs) return 1;
  const estimate = callsPerSample(first, targetMs, max);
  const perCall = await timeCalls(run, estimate, now) / estimate;
  return callsPerSample(perCall, targetMs, max);
}
