/**
 * Self-contained SVG primitives for the benchmark report.
 *
 * The report is opened from disk, so every chart is rendered here as plain SVG
 * with no runtime chart library, CDN, or network request.
 */

export function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function fmtNumber(value, digits = 4) {
  return Number.isFinite(value) ? Number(value).toPrecision(digits) : "—";
}

export function fmtMs(value) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 100) return `${value.toFixed(1)} ms`;
  if (Math.abs(value) >= 1) return `${value.toFixed(2)} ms`;
  return `${value.toPrecision(3)} ms`;
}

export function fmtBytes(value) {
  if (!Number.isFinite(value)) return "—";
  const units = ["B", "KiB", "MiB", "GiB"];
  let scaled = value, unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) { scaled /= 1024; unit++; }
  return `${scaled.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function fmtDeltaMs(value) {
  if (!Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  if (magnitude >= 1) return `${value.toFixed(2)} ms`;
  if (magnitude >= 0.001) return `${(value * 1000).toFixed(1)} µs`;
  return `${(value * 1e6).toFixed(0)} ns`;
}

export function fmtPercent(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function shortRevision(value) {
  return String(value ?? "").slice(0, 7) || "run";
}

function hash(value) {
  let result = 0;
  for (const char of String(value)) result = Math.imul(result, 31) + char.charCodeAt(0) | 0;
  return Math.abs(result);
}

function xAxisLabels(points, x) {
  if (points.length === 1) return `<text x="${x(0)}" y="152" text-anchor="middle">${escapeXml(shortRevision(points[0].revision ?? points[0].createdAt))}</text>`;
  return `<text x="${x(0)}" y="152" text-anchor="start">${escapeXml(shortRevision(points[0].revision ?? points[0].createdAt))}</text><text x="${x(points.length - 1)}" y="152" text-anchor="end">${escapeXml(shortRevision(points.at(-1).revision ?? points.at(-1).createdAt))}</text>`;
}

/** One case trend: median line, min–max fork band, first-run reference. */
export function trendChart(series, { width = 360, height = 160 } = {}) {
  const points = series.runs.filter((run) => Number.isFinite(run.forkMedianMs));
  if (!points.length) return `<p class="empty">No timed runs.</p>`;
  const left = 48, right = 14, top = 12, bottom = 30;
  const lows = points.map((point) => Number.isFinite(point.minForkMedianMs) ? point.minForkMedianMs : point.forkMedianMs);
  const highs = points.map((point) => Number.isFinite(point.maxForkMedianMs) ? point.maxForkMedianMs : point.forkMedianMs);
  let low = Math.min(...lows), high = Math.max(...highs);
  const padding = Math.max(high - low, Math.abs(high) * 0.08, 0.000001) * 0.15;
  low = Math.max(0, low - padding); high += padding;
  const plotHeight = height - top - bottom;
  const x = (index) => points.length === 1 ? (left + width - right) / 2 : left + index * (width - left - right) / (points.length - 1);
  const y = (value) => top + plotHeight * (1 - (value - low) / (high - low));
  const grid = [0, 0.5, 1].map((share) => {
    const value = high - (high - low) * share;
    return `<line x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}" stroke="#e5e9ed"/><text x="${left - 6}" y="${y(value) + 3}" text-anchor="end">${escapeXml(value.toPrecision(3))}</text>`;
  }).join("");
  const baseline = Number.isFinite(points[0].forkMedianMs)
    ? `<line x1="${left}" y1="${y(points[0].forkMedianMs)}" x2="${width - right}" y2="${y(points[0].forkMedianMs)}" stroke="#94a3b8" stroke-dasharray="3 4"/>`
    : "";
  const line = points.map((point, index) => `${x(index)},${y(point.forkMedianMs)}`).join(" ");
  const marks = points.map((point, index) => {
    const gc = point.gc?.msPerCall;
    const tip = `${point.runId}\n${shortRevision(point.revision ?? point.createdAt)} · median ${fmtMs(point.forkMedianMs)}\nrange ${fmtMs(point.minForkMedianMs)} – ${fmtMs(point.maxForkMedianMs)}${Number.isFinite(gc) ? `\nGC ${fmtMs(gc)}/call` : ""}`;
    return `<line x1="${x(index)}" y1="${y(lows[index])}" x2="${x(index)}" y2="${y(highs[index])}" stroke="#64748b" stroke-width="4" stroke-linecap="round"/><circle cx="${x(index)}" cy="${y(point.forkMedianMs)}" r="${index === points.length - 1 ? 4.5 : 3}" fill="${index === points.length - 1 ? "#0b6bcb" : "#3b82f6"}" stroke="#fff" stroke-width="1"><title>${escapeXml(tip)}</title></circle>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(series.caseId)} trend">${grid}${baseline}<polyline points="${line}" fill="none" stroke="hsl(${hash(series.caseId) % 360} 62% 42%)" stroke-width="2"/>${marks}${xAxisLabels(points, x)}</svg>`;
}

/** Diverging bars of the latest change per case, sorted by absolute change. */
export function rankingChart(changes, { width = 900, rowHeight = 26, limit = 18 } = {}) {
  const points = [...changes].filter((change) => Number.isFinite(change.percent)).sort((a, b) => Math.abs(b.percent) - Math.abs(a.percent)).slice(0, limit);
  if (!points.length) return `<p class="empty">At least two comparable runs per case are needed for a change ranking.</p>`;
  const zero = 560, scale = 280, height = points.length * rowHeight + 8;
  const maxAbs = Math.max(...points.map((point) => Math.abs(point.percent)), 1);
  const rows = points.map((point, index) => {
    const top = index * rowHeight + 4;
    const length = Math.abs(point.percent) / maxAbs * scale;
    const left = point.percent >= 0 ? zero : zero - length;
    const color = point.status === "regression" ? "#c2412d" : point.status === "improvement" ? "#16794a" : "#8a94a6";
    const label = `${point.percent >= 0 ? "+" : ""}${point.percent.toFixed(1)}%`;
    const detail = `${fmtDeltaMs(point.fromMs)} → ${fmtDeltaMs(point.toMs)}`;
    const labelText = point.label ?? point.caseId;
    return `<g><text x="8" y="${top + 12}" text-anchor="start">${escapeXml(labelText.length > 42 ? `${labelText.slice(0, 40)}…` : labelText)}</text><rect x="${left}" y="${top + 2}" width="${Math.max(1, length)}" height="14" rx="3" fill="${color}"><title>${escapeXml(`${point.caseId}\n${label} (${detail})\n${point.fromRunId} → ${point.toRunId}`)}</title></rect><text x="${zero + (point.percent >= 0 ? length + 6 : -length - 6)}" y="${top + 13}" text-anchor="${point.percent >= 0 ? "start" : "end"}">${label}</text></g>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Change ranking">${rows}<line x1="${zero}" y1="0" x2="${zero}" y2="${height}" stroke="#cbd5e1"/></svg>`;
}

/** Latency box plot for the latest run: p5–p95 whiskers, p25–p75 box, median. */
export function boxPlot(run, { width = 300, height = 42 } = {}) {
  const distribution = run.distribution;
  if (!distribution) return "";
  const low = Math.max(0, (distribution.min ?? distribution.median ?? 0) - Math.max((distribution.max ?? 0) - (distribution.min ?? 0), Math.abs(distribution.median ?? 0) * 0.05, 0.000001) * 0.08);
  const high = (distribution.max ?? distribution.median ?? 0) + Math.max((distribution.max ?? 0) - (distribution.min ?? 0), Math.abs(distribution.median ?? 0) * 0.05, 0.000001) * 0.08;
  const span = Math.max(high - low, Math.abs(high) * 0.02, 0.000001);
  const left = 8, right = 8, middle = height / 2, plotWidth = width - left - right;
  const x = (value) => left + plotWidth * ((value - low) / span);
  const p5 = distribution.p5 ?? distribution.min ?? distribution.median;
  const p95 = distribution.p95 ?? distribution.max ?? distribution.median;
  const q1 = distribution.p25 ?? p5;
  const q3 = distribution.p75 ?? p95;
  const median = distribution.median;
  const tip = `min ${fmtMs(distribution.min)}\np5 ${fmtMs(distribution.p5)}\np25 ${fmtMs(distribution.p25)}\nmedian ${fmtMs(distribution.median)}\np75 ${fmtMs(distribution.p75)}\np95 ${fmtMs(distribution.p95)}\np99 ${fmtMs(distribution.p99)}\nmax ${fmtMs(distribution.max)}\nsamples ${distribution.sampleCount}`;
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(run.runId)} distribution"><title>${escapeXml(tip)}</title><line x1="${x(p5)}" y1="${middle}" x2="${x(p95)}" y2="${middle}" stroke="#64748b"/><line x1="${x(p5)}" y1="${middle - 6}" x2="${x(p5)}" y2="${middle + 6}" stroke="#64748b"/><line x1="${x(p95)}" y1="${middle - 6}" x2="${x(p95)}" y2="${middle + 6}" stroke="#64748b"/><rect x="${x(q1)}" y="${middle - 9}" width="${Math.max(2, x(q3) - x(q1))}" height="18" rx="3" fill="#cfe3f7" stroke="#3977b7"/><line x1="${x(median)}" y1="${middle - 11}" x2="${x(median)}" y2="${middle + 11}" stroke="#0b4f8a" stroke-width="2"/><circle cx="${x(distribution.min)}" cy="${middle}" r="2" fill="#64748b"/><circle cx="${x(distribution.max)}" cy="${middle}" r="2" fill="#c2412d"/></svg>`;
}

/** Compact within-window shape; bucket maxima keep GC pauses visible. */
export function sparkline(values, { width = 120, height = 24, color = "#0b6bcb" } = {}) {
  if (!values?.length) return "";
  const max = Math.max(...values), min = Math.min(...values);
  const span = Math.max(max - min, Math.abs(max) * 0.05, 0.000001);
  const x = (index) => values.length === 1 ? width / 2 : index * width / (values.length - 1);
  const y = (value) => height - 2 - (height - 4) * ((value - min) / span);
  const points = values.map((value, index) => `${x(index).toFixed(2)},${y(value).toFixed(2)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="Window samples"><title>${escapeXml(`window min ${fmtMs(min)}, max ${fmtMs(max)}, last ${fmtMs(values.at(-1))}`)}</title><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5"/><circle cx="${x(values.length - 1)}" cy="${y(values.at(-1))}" r="2" fill="${color}"/></svg>`;
}

/** Green-to-red heat scale for normalized rank (0 = cool, 1 = hot). */
export function heatColor(rank) {
  const clamped = Math.max(0, Math.min(1, rank));
  return `hsl(${145 - clamped * 130} 62% ${94 - clamped * 38}%)`;
}

export function heatTextColor(rank) {
  return rank > 0.62 ? "#fff" : "#17202a";
}
