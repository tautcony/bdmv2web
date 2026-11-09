/** Distribution helpers shared by the runner, comparison, and reports. */

export function percentile(values, p) {
  if (!values.length) return null;
  return percentileOfSorted([...values].sort((a, b) => a - b), p);
}

function percentileOfSorted(sorted, p) {
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * p, low = Math.floor(at), high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

export function median(values) {
  return percentile(values, 0.5);
}

/**
 * Per-call distribution. Percentiles are linear-interpolated over the sorted
 * samples; outliers use the 1.5 IQR fence; throughput is calls per second at
 * the median.
 */
export function summarizeSamples(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sampleCount = sorted.length;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sampleCount;
  const deviation = Math.sqrt(sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sampleCount);
  const medianValue = percentileOfSorted(sorted, 0.5);
  const q1 = percentileOfSorted(sorted, 0.25), q3 = percentileOfSorted(sorted, 0.75), iqr = q3 - q1;
  const lowFence = q1 - 1.5 * iqr, highFence = q3 + 1.5 * iqr;
  const outliers = sorted.filter((value) => value < lowFence || value > highFence).length;
  return {
    min: sorted[0], max: sorted[sampleCount - 1], mean, median: medianValue,
    p90: percentileOfSorted(sorted, 0.9), p95: percentileOfSorted(sorted, 0.95), p99: percentileOfSorted(sorted, 0.99),
    deviation, cvPercent: mean === 0 ? 0 : deviation / mean * 100,
    mad: percentileOfSorted(sorted.map((value) => Math.abs(value - medianValue)).sort((a, b) => a - b), 0.5),
    iqr, outlierCount: outliers, outlierPercent: sampleCount ? outliers / sampleCount * 100 : 0,
    throughputPerSecond: medianValue > 0 ? 1000 / medianValue : null,
    sampleCount,
  };
}

export function summarizeForks(values) {
  return { ...summarizeSamples(values), forkCount: values.length };
}

/** One observation per independent child process; within-fork samples stay separate. */
export function forkMedians(row) {
  return (row?.forks ?? []).map((fork) => fork?.stats?.median).filter((value) => Number.isFinite(value) && value >= 0);
}
