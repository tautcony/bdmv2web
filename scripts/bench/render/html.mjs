import { relative, resolve, sep } from "node:path";
import {
  boxPlot, escapeXml, fmtBytes, fmtDeltaMs, fmtMs, fmtNumber, fmtPercent,
  heatColor, heatTextColor, rankingChart, sparkline, trendChart,
} from "./charts.mjs";

const CHANGE_RELATIVE_PERCENT = 10;
const CHANGE_ABSOLUTE_MS = 0.05;

function repositoryRoot(trend) {
  for (const series of trend.series) if (series.environment?.repositoryRoot) return series.environment.repositoryRoot;
  return null;
}
/** Recorded stack traces can carry absolute paths; keep them out of the rendered report. */
export function cleanText(value, root) {
  let text = String(value ?? "");
  if (root) text = text.replaceAll(`file://${root}`, "<repo>").replaceAll(root, "<repo>");
  text = text.replace(/file:\/\/\/Users\/[^/\s)]+\//g, "file://<home>/")
    .replace(/\/Users\/[^/\s)]+\//g, "<home>/")
    .replace(/[A-Za-z]:\\Users\\[^\\\s)]+\\/g, "<home>\\");
  return text;
}
function statusCounts(statuses) {
  let failed = 0, skipped = 0;
  for (const item of statuses) { if (item.status === "failed") failed++; else skipped++; }
  return { failed, skipped };
}
function sourceLabel(series) {
  if (!series.source) return series.sample ?? "";
  return [series.source.disc, series.source.path].filter(Boolean).join(" · ");
}
function cpuLabel(environment) {
  return environment?.cpuModel ?? `${environment?.platform ?? "?"}/${environment?.architecture ?? "?"}`;
}
function profileHref(profile, baseDir) {
  return relative(baseDir, resolve(profile.runDirectory, profile.path)).split(sep).join("/");
}
function profileLinks(profiles, baseDir) {
  return profiles.map((profile) => `<a href="${escapeXml(profileHref(profile, baseDir))}">${escapeXml(profile.path)}</a>`).join("<br>");
}
function formatDrift(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "—";
}
function unstableMark(run) {
  if (!run.unstable) return "";
  return run.gcEvents > 0 ? " ! gc" : " !";
}
function changeBadge(change) {
  if (!change) return `<span class="badge">single run</span>`;
  const className = change.status === "regression" ? "regression" : change.status === "improvement" ? "improvement" : "stable";
  const label = `${fmtPercent(change.percent)} · ${fmtDeltaMs(change.deltaMs)}`;
  return `<span class="badge ${className}" title="${escapeXml(`${change.fromRunId} → ${change.toRunId}`)}">${escapeXml(label)}</span>`;
}
function attr(value) { return escapeXml(value ?? ""); }
function dataAttrs(series) {
  return `data-case="${attr(series.caseId)}" data-name="${attr(series.name ?? series.caseId)}" data-category="${attr(series.category)}" data-env="${attr(series.environmentSeries)}" data-current="${series.current ? "true" : "false"}"`;
}
function latestEntries(trend, { currentOnly = false } = {}) {
  return trend.series
    .filter((series) => !currentOnly || series.current)
    .map((series) => ({ series, run: series.runs.at(-1) }))
    .filter((entry) => entry.run);
}
function changesOf(trend) {
  return trend.series.filter((series) => series.current).map((series) => series.change).filter(Boolean);
}
function kpi(label, value, detail, className = "") {
  return `<div class="kpi ${className}"><span>${escapeXml(label)}</span><strong>${escapeXml(value)}</strong><small>${escapeXml(detail)}</small></div>`;
}
function hotspotCard(title, entries, format, unit, detail = () => "") {
  const items = entries.length
    ? entries.map((entry) => `<li><span class="value">${escapeXml(format(entry.value))}</span> ${escapeXml(unit)}<br><small>${escapeXml(entry.caseId)} · ${escapeXml(entry.environmentSeries)}${escapeXml(detail(entry))}</small></li>`).join("")
    : `<li class="empty">No data.</li>`;
  return `<div class="hotspot"><h3>${escapeXml(title)}</h3><ol>${items}</ol></div>`;
}
function heatmap(trend) {
  const latest = latestEntries(trend, { currentOnly: true });
  const metrics = [
    { key: "median", label: "Median", value: (run) => run.forkMedianMs, display: (run) => fmtMs(run.forkMedianMs) },
    { key: "p95", label: "p95", value: (run) => run.p95Ms, display: (run) => fmtMs(run.p95Ms) },
    { key: "gc", label: "GC / call", value: (run) => run.gc?.parentOnly ? null : run.gc?.msPerCall, display: (run) => run.gc?.parentOnly ? "parent" : fmtMs(run.gc?.msPerCall) },
    { key: "gcEvents", label: "GC events", value: (run) => run.gc?.parentOnly ? null : run.gc?.events, display: (run) => run.gc?.parentOnly ? "parent" : `${run.gc?.events ?? "—"}` },
    { key: "heap", label: "Heap peak", value: (run) => run.memory?.parentOnly ? null : run.memory?.heapUsedBytes, display: (run) => run.memory?.parentOnly ? "parent" : fmtBytes(run.memory?.heapUsedBytes) },
    { key: "cv", label: "Median CV", value: (run) => run.medianCvPercent, display: (run) => `${fmtNumber(run.medianCvPercent, 3)}%` },
    { key: "drift", label: "|Drift|", value: (run) => Number.isFinite(run.driftPercent) ? Math.abs(run.driftPercent) : null, display: (run) => `${formatDrift(run.driftPercent)}%` },
  ];
  const rankByRun = new Map();
  for (const metric of metrics) {
    const sorted = latest.map((entry) => metric.value(entry.run)).filter(Number.isFinite).sort((a, b) => a - b);
    const ranks = new Map();
    for (const entry of latest) {
      const value = metric.value(entry.run);
      if (!Number.isFinite(value)) continue;
      const index = sorted.indexOf(value);
      ranks.set(entry.run, sorted.length <= 1 ? 0 : index / (sorted.length - 1));
    }
    rankByRun.set(metric.key, ranks);
  }
  const rows = [...latest].sort((a, b) => (b.run.forkMedianMs ?? -Infinity) - (a.run.forkMedianMs ?? -Infinity)).map(({ series, run }) => {
    const cells = metrics.map((metric) => {
      const rank = rankByRun.get(metric.key)?.get(run) ?? 0;
      return `<td class="num heat" style="background:${heatColor(rank)};color:${heatTextColor(rank)}" title="${escapeXml(metric.label)} rank ${(rank * 100).toFixed(0)}%">${escapeXml(metric.display(run))}</td>`;
    }).join("");
    return `<tr ${dataAttrs(series)}><td><strong>${escapeXml(series.name || series.caseId)}</strong><span class="sub">${escapeXml(series.caseId)} · ${escapeXml(series.category ?? "")}</span></td>${cells}</tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="heatmap"><thead><tr><th>Case</th>${metrics.map((metric) => `<th class="num">${escapeXml(metric.label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
function trendCards(trend) {
  return latestEntries(trend).map(({ series, run }) => `
<article class="trend-card" ${dataAttrs(series)}>
  <header><div><h3>${escapeXml(series.name || series.caseId)}</h3><p>${escapeXml(series.caseId)} · ${escapeXml(series.category ?? "")} · ${escapeXml(series.environmentSeries)}${series.current ? "" : " · historical"}</p></div>${changeBadge(series.change)}</header>
  ${trendChart(series)}
  <dl class="mini-stats">
    <div><dt>latest</dt><dd>${escapeXml(fmtMs(run.forkMedianMs))}</dd></div>
    <div><dt>p95</dt><dd>${escapeXml(fmtMs(run.p95Ms))}</dd></div>
    <div><dt>GC / call</dt><dd>${escapeXml(run.gc?.parentOnly ? "parent" : fmtMs(run.gc?.msPerCall))}</dd></div>
    <div><dt>heap</dt><dd>${escapeXml(run.memory?.parentOnly ? "parent" : fmtBytes(run.memory?.heapUsedBytes))}</dd></div>
  </dl>
</article>`).join("");
}
function distributionTable(trend) {
  const rows = latestEntries(trend, { currentOnly: true }).sort((a, b) => (b.run.forkMedianMs ?? -Infinity) - (a.run.forkMedianMs ?? -Infinity)).map(({ series, run }) => `
<tr ${dataAttrs(series)}>
  <td><strong>${escapeXml(series.name || series.caseId)}</strong><span class="sub">${escapeXml(series.caseId)}</span></td>
  <td>${boxPlot(run)}</td>
  <td class="num">${escapeXml(fmtMs(run.distribution?.median ?? run.forkMedianMs))}</td>
  <td class="num">${escapeXml(fmtMs(run.distribution?.p95 ?? run.p95Ms))}</td>
  <td class="num">${escapeXml(fmtMs(run.distribution?.p99 ?? run.p99Ms))}</td>
  <td class="num">${escapeXml(fmtMs(run.distribution?.max))}</td>
  <td class="num">${run.distribution?.sampleCount ? run.distribution.sampleCount : `<span class="pill">summary</span>`}</td>
  <td class="num">${run.gc?.parentOnly ? `<span class="pill">parent</span>` : `${escapeXml(fmtMs(run.gc?.msPerCall))}<span class="sub">${run.gc?.events ?? 0} events</span>`}</td>
</tr>`).join("");
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Case</th><th>Latest distribution</th><th class="num">median</th><th class="num">p95</th><th class="num">p99</th><th class="num">max</th><th class="num">samples</th><th class="num">GC / call</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function latestTable(trend, baseDir) {
  const rows = latestEntries(trend).sort((a, b) => a.series.caseId.localeCompare(b.series.caseId)).map(({ series, run }) => {
    const change = series.change;
    const href = relative(baseDir, resolve(run.file)).split(sep).join("/");
    return `<tr ${dataAttrs(series)}>
<td><strong>${escapeXml(series.name || series.caseId)}</strong><span class="sub">${escapeXml(series.caseId)} · ${escapeXml(sourceLabel(series))}</span></td>
<td>${escapeXml(series.category ?? "")}</td><td>${escapeXml(series.environmentSeries)}</td>
<td class="num" data-sort-value="${run.forkMedianMs ?? ""}">${escapeXml(fmtMs(run.forkMedianMs))}</td>
<td class="num" data-sort-value="${change?.percent ?? ""}">${changeBadge(change)}</td>
<td class="num" data-sort-value="${run.p95Ms ?? ""}">${escapeXml(fmtMs(run.p95Ms))}</td>
<td class="num" data-sort-value="${run.p99Ms ?? ""}">${escapeXml(fmtMs(run.p99Ms))}</td>
<td class="num" data-sort-value="${run.worstCvPercent ?? ""}">${escapeXml(fmtNumber(run.worstCvPercent, 3))}%</td>
<td class="num" data-sort-value="${run.driftPercent ?? ""}">${formatDrift(run.driftPercent)}${unstableMark(run)}</td>
<td class="num" data-sort-value="${run.gc?.parentOnly ? "" : run.gc?.msPerCall ?? ""}">${run.gc?.parentOnly ? `<span class="pill">parent</span>` : `${escapeXml(fmtMs(run.gc?.msPerCall))}<span class="sub">${run.gc?.events ?? 0} events · ${run.gc?.major ?? 0} major</span>`}</td>
<td class="num" data-sort-value="${run.memory?.parentOnly ? "" : run.memory?.heapUsedBytes ?? ""}">${run.memory?.parentOnly ? `<span class="pill">parent</span>` : escapeXml(fmtBytes(run.memory?.heapUsedBytes))}</td>
<td class="num" data-sort-value="${run.cpuParentOnly ? "" : run.cpuMsPerCall ?? ""}">${run.cpuParentOnly ? `<span class="pill">parent</span>` : escapeXml(fmtMs(run.cpuMsPerCall))}</td>
<td>${sparkline(run.sampleWindow)}</td>
<td class="num">${run.callsPerSample}</td>
<td class="num" data-sort-value="${run.transport?.nullPacketShare ?? ""}">${run.transport ? `${(run.transport.nullPacketShare * 100).toFixed(2)}% null<span class="sub">${run.transport.packets} packets</span>` : "—"}</td>
<td class="num">${run.forkCount}</td>
<td class="num">${escapeXml(fmtMs(run.minForkMedianMs))}–${escapeXml(fmtMs(run.maxForkMedianMs))}</td>
<td><a href="${escapeXml(href)}">${escapeXml(run.runId)}</a></td>
<td>${profileLinks(run.profiles, baseDir) || "—"}</td>
</tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="data-table"><thead><tr>
<th data-sort="text">Case</th><th data-sort="text">Category</th><th data-sort="text">Env</th>
<th class="num" data-sort="number">Median of fork medians (ms)</th><th class="num" data-sort="number">Change</th>
<th class="num" data-sort="number">p95 (ms)</th><th class="num" data-sort="number">p99 (ms)</th>
<th class="num" data-sort="number">Worst fork CV %</th><th class="num" data-sort="number">Drift %</th>
<th class="num" data-sort="number">GC ms/call</th><th class="num" data-sort="number">Heap peak</th><th class="num" data-sort="number">CPU ms/call</th><th>Window</th>
<th class="num" data-sort="number">Calls/sample</th><th class="num" data-sort="number">Input null share</th><th class="num" data-sort="number">Forks</th>
<th class="num" data-sort="number">Fork median range (ms)</th><th data-sort="text">Run</th><th>CPU profiles</th>
</tr></thead><tbody>${rows}</tbody></table></div>`;
}
function historyTable(trend, baseDir) {
  const rows = trend.series.flatMap((series) => series.runs.map((run) => {
    const href = relative(baseDir, resolve(run.file)).split(sep).join("/");
    return `<tr ${dataAttrs(series)}><td>${escapeXml(series.caseId)}</td><td>${escapeXml(series.environmentSeries)}</td><td><a href="${escapeXml(href)}">${escapeXml(run.runId)}</a></td><td>${escapeXml(String(run.revision ?? "").slice(0, 10))}</td><td class="num">${run.callsPerSample}</td><td class="num">${escapeXml(fmtMs(run.forkMedianMs))}</td><td class="num">${escapeXml(fmtMs(run.minForkMedianMs))}–${escapeXml(fmtMs(run.maxForkMedianMs))}</td><td class="num">${escapeXml(fmtMs(run.p95Ms))}</td><td class="num">${escapeXml(fmtMs(run.p99Ms))}</td><td class="num">${escapeXml(fmtNumber(run.worstCvPercent, 3))}%</td><td class="num">${escapeXml(fmtNumber(run.outlierPercent, 3))}%</td><td class="num">${formatDrift(run.driftPercent)}${unstableMark(run)}</td><td class="num">${run.gc?.events ?? 0}</td><td class="num">${escapeXml(fmtBytes(run.memory?.heapUsedBytes))}</td><td>${profileLinks(run.profiles, baseDir) || "—"}</td></tr>`;
  })).join("");
  return `<details class="panel"><summary>All run records (${trend.series.reduce((sum, series) => sum + series.runs.length, 0)})</summary><p>Every measured row, including history used by the trend lines.</p><div class="table-wrap"><table class="data-table"><thead><tr><th data-sort="text">Case</th><th data-sort="text">Env</th><th data-sort="text">Run</th><th data-sort="text">Revision</th><th class="num" data-sort="number">Calls/sample</th><th class="num" data-sort="number">Median (ms)</th><th class="num" data-sort="number">Range (ms)</th><th class="num" data-sort="number">p95 (ms)</th><th class="num" data-sort="number">p99 (ms)</th><th class="num" data-sort="number">CV %</th><th class="num" data-sort="number">Outliers %</th><th class="num" data-sort="number">Drift %</th><th class="num" data-sort="number">GC events</th><th class="num" data-sort="number">Heap peak</th><th>Profiles</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}
function captureTable(trend, baseDir) {
  const rows = trend.profileRuns.map((capture) => capture.artifacts.map((artifact) => {
    const href = relative(baseDir, resolve(artifact.runDirectory, artifact.path)).split(sep).join("/");
    return `<tr><td>${escapeXml(capture.caseId)}</td><td><span class="pill">${escapeXml(capture.mode)}</span></td><td>${escapeXml(capture.fixture?.id ?? "")}</td><td>${escapeXml(capture.environment?.buildMode ?? "unknown")} (${escapeXml(String(capture.environment?.profileBuildMode ?? "unknown"))})</td><td>${escapeXml(cpuLabel(capture.environment))}</td><td>${escapeXml(capture.runId)}</td><td><a href="${escapeXml(href)}">${escapeXml(artifact.path)}</a></td></tr>`;
  }).join("")).join("");
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Case</th><th>Mode</th><th>Fixture</th><th>Build mode</th><th>Environment</th><th>Run</th><th>Artifact</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function statusSection(trend, baseDir) {
  const counts = statusCounts(trend.statuses);
  if (!trend.statuses.length) return `<section class="panel"><h2>Recorded run failures and skips</h2><p>None of the source records report a failed or skipped case.</p></section>`;
  const rows = trend.statuses.map((item) => {
    const href = item.file ? relative(baseDir, item.file).split(sep).join("/") : null;
    const run = href ? `<a href="${escapeXml(href)}">${escapeXml(item.runId)}</a>` : escapeXml(item.runId);
    const reasonText = cleanText(item.reason, repositoryRoot(trend)).replaceAll("\n", " ");
    const reason = escapeXml(reasonText.slice(0, 220)) + (reasonText.length > 220 ? "…" : "");
    return `<tr><td>${run}</td><td>${escapeXml(item.caseId)}</td><td><span class="badge ${item.status === "failed" ? "regression" : "stable"}">${escapeXml(item.status)}</span></td><td>${reason}</td></tr>`;
  }).join("");
  return `<section class="panel"><h2>Recorded run failures and skips</h2><p>${counts.failed} failed and ${counts.skipped} skipped case records come from the source runs; they do not describe this report's rendering.</p><div class="table-wrap"><table class="data-table"><thead><tr><th>Run</th><th>Case</th><th>Status</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}
function toolbar(trend) {
  const environments = [...new Set(trend.series.map((series) => series.environmentSeries))].sort();
  const categories = [...new Set(trend.series.map((series) => series.category).filter(Boolean))].sort();
  return `<div class="toolbar">
<label>Environment<select id="filter-env"><option value="">All environments</option>${environments.map((env) => `<option value="${attr(env)}">${escapeXml(env)}</option>`).join("")}</select></label>
<label>Category<select id="filter-category"><option value="">All categories</option>${categories.map((category) => `<option value="${attr(category)}">${escapeXml(category)}</option>`).join("")}</select></label>
<label>Search<input id="filter-search" type="search" placeholder="case id or name"></label>
<label class="check"><input id="filter-current" type="checkbox" checked> Current session only</label>
<span id="filter-count">${trend.series.length} cases shown</span>
<button id="filter-reset" type="button">Reset</button>
</div><p class="hint">Filters apply to the trend cards and tables. KPI cards, the change ranking, and the hotspot lists always describe the current session.</p>`;
}
function script() {
  return `<script>
(() => {
  const env = document.getElementById("filter-env");
  const category = document.getElementById("filter-category");
  const search = document.getElementById("filter-search");
  const current = document.getElementById("filter-current");
  const count = document.getElementById("filter-count");
  const cards = [...document.querySelectorAll(".trend-card[data-case]")];
  const apply = () => {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    for (const element of document.querySelectorAll("[data-case]")) {
      const ok = (!current.checked || element.dataset.current === "true")
        && (!env.value || element.dataset.env === env.value)
        && (!category.value || element.dataset.category === category.value)
        && (!query || (element.dataset.case + " " + element.dataset.name).toLowerCase().includes(query));
      if (element.tagName === "g") element.style.display = ok ? "" : "none";
      else element.hidden = !ok;
      if (element.classList.contains("trend-card") && ok) visible++;
    }
    count.textContent = visible + " of " + cards.length + " cases shown";
  };
  for (const control of [env, category, search, current]) control.addEventListener("input", apply);
  document.getElementById("filter-reset").addEventListener("click", () => { env.value = ""; category.value = ""; search.value = ""; current.checked = true; apply(); });
  apply();
  for (const th of document.querySelectorAll("th[data-sort]")) th.addEventListener("click", () => {
    const table = th.closest("table"), body = table.tBodies[0];
    const index = [...th.parentNode.children].indexOf(th);
    // Numeric performance columns start descending; text columns start ascending.
    const direction = th.dataset.dir ? (th.dataset.dir === "asc" ? -1 : 1) : (th.dataset.sort === "number" ? -1 : 1);
    for (const header of th.parentNode.children) delete header.dataset.dir;
    th.dataset.dir = direction === 1 ? "asc" : "desc";
    [...body.rows].sort((left, right) => {
      const a = left.cells[index]?.dataset.sortValue ?? left.cells[index]?.textContent.trim() ?? "";
      const b = right.cells[index]?.dataset.sortValue ?? right.cells[index]?.textContent.trim() ?? "";
      const an = Number(a), bn = Number(b);
      return (Number.isFinite(an) && Number.isFinite(bn) ? an - bn : String(a).localeCompare(String(b))) * direction;
    }).forEach((row) => body.appendChild(row));
  });
})();
</script>`;
}

function embedTrend(trend, baseDir) {
  const rel = (value) => value ? relative(baseDir, resolve(value)).split(sep).join("/") : value;
  const environment = (value) => value ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "repositoryRoot")) : value;
  return {
    ...trend,
    series: trend.series.map((series) => ({
      ...series,
      environment: environment(series.environment),
      runs: series.runs.map((run) => ({
        ...run,
        file: rel(run.file),
        profiles: run.profiles.map((profile) => ({ ...profile, runDirectory: rel(profile.runDirectory) })),
      })),
    })),
    profileRuns: trend.profileRuns.map((capture) => ({
      ...capture,
      environment: environment(capture.environment),
      artifacts: capture.artifacts.map((artifact) => ({ ...artifact, runDirectory: rel(artifact.runDirectory) })),
    })),
    statuses: trend.statuses.map((item) => ({ ...item, file: rel(item.file), reason: cleanText(item.reason, repositoryRoot(trend)) })),
  };
}

export function html(trend, baseDir = process.cwd()) {
  const summary = trend.summary ?? {};
  const changes = changesOf(trend);
  const environments = trend.environments ?? [];
  const slowest = summary.hotspots?.slowest?.[0];
  const gcHotspot = summary.hotspots?.gc?.[0];
  const kpis = [
    kpi("Current cases", String(summary.cases ?? trend.series.length), `${summary.currentRuns ?? "?"} current / ${summary.runs ?? trend.runCount} total runs · ${summary.allSeries ?? trend.series.length} series`),
    kpi("Regressions", String(summary.regressions ?? 0), `latest vs previous · ≥${CHANGE_RELATIVE_PERCENT}% and ≥${CHANGE_ABSOLUTE_MS} ms`, summary.regressions ? "bad" : ""),
    kpi("Improvements", String(summary.improvements ?? 0), "same thresholds, faster", summary.improvements ? "good" : ""),
    kpi("Unstable", String(summary.unstable ?? 0), "latest run drifted ≥25%", summary.unstable ? "warn" : ""),
    kpi("Failures / skips", `${summary.failures ?? 0} / ${summary.skips ?? 0}`, "current-session source-run status", summary.failures ? "bad" : ""),
    kpi(slowest && Number.isFinite(slowest.floorMs) ? "Slowest work" : "Slowest", slowest ? fmtMs(slowest.value) : "—", slowest ? `${slowest.caseId}${Number.isFinite(slowest.floorMs) ? ` · floor ${fmtMs(slowest.floorMs)}` : ""}` : "no timed rows"),
    kpi("GC hotspot", gcHotspot ? fmtMs(gcHotspot.value) : "—", gcHotspot ? `${gcHotspot.caseId} per call` : "no GC series", gcHotspot ? "warn" : ""),
  ].join("");
  const hotspot = `<section class="panel"><div class="section-head"><h2>Hotspots</h2><p>Latest run per case. Heat cells are ranked within each column across the visible environment; deeper colour means a higher value.</p></div>
<div class="hotspot-grid">
${hotspotCard("GC time per call", summary.hotspots?.gc ?? [], fmtMs, "per call")}
${hotspotCard("Heap peak", summary.hotspots?.heap ?? [], fmtBytes, "")}
${hotspotCard("Slowest work median", summary.hotspots?.slowest ?? [], fmtMs, "", (entry) => Number.isFinite(entry.floorMs) ? ` · floor ${fmtMs(entry.floorMs)} of ${fmtMs(entry.medianMs)}` : "")}
${hotspotCard("Median CV", summary.hotspots?.variable ?? [], (value) => `${fmtNumber(value, 3)}%`, "")}
</div>
${heatmap(trend)}
</section>`;
  const shownChanges = Math.min(18, changes.length);
  const changeSummary = changes.length ? `${changes.length} comparable pairs; the chart shows the ${shownChanges} largest changes.` : "No comparable run pair in the current session yet.";
  const changesPanel = `<section class="panel" id="changes"><div class="section-head"><h2>Performance change</h2><p>Latest run vs previous run for the same case, fixture, scope, and environment. ${changeSummary} Grey stays inside the ${CHANGE_RELATIVE_PERCENT}% / ${CHANGE_ABSOLUTE_MS} ms threshold.</p></div><div class="chart-wrap">${rankingChart(changes)}</div><div class="legend"><span><span class="dot" style="background:#16794a"></span>improvement</span><span><span class="dot" style="background:#c2412d"></span>regression</span><span><span class="dot" style="background:#8a94a6"></span>stable</span></div></section>`;
  const trendsPanel = `<section class="panel" id="trends"><div class="section-head"><h2>Trends by case</h2><p>Each chart has one point per run: median of independent fork medians, with the min–max fork band and the first run as a dashed reference. Hover a point for run details.</p></div><div class="trend-grid">${trendCards(trend)}</div></section>`;
  const distributionPanel = `<section class="panel" id="distribution"><div class="section-head"><h2>Latency distribution</h2><p>Latest run samples combined across forks: p5–p95 whiskers, p25–p75 box, median line, and min/max dots. The table falls back to fork summaries when samples are unavailable.</p></div>${distributionTable(trend)}</section>`;
  const latestPanel = `<section class="panel" id="latest"><div class="section-head"><h2>Latest results</h2><p>One row per case and environment. Click a column header to sort; the toolbar filters all cases.</p></div>${latestTable(trend, baseDir)}</section>`;
  const environmentPanel = environments.length ? `<section class="panel"><h2>Environments</h2><p>Series are separated by runtime identity; a change in any field starts a new series.</p><div class="table-wrap"><table class="data-table"><thead><tr><th>Series</th><th>Node</th><th>Platform</th><th>CPU</th><th>Build mode</th><th>CLI build</th></tr></thead><tbody>${environments.map((environment) => `<tr><td>${escapeXml(environment.label)}</td><td>${escapeXml(environment.node ?? "")}</td><td>${escapeXml(`${environment.platform ?? ""}/${environment.architecture ?? ""}`)}</td><td>${escapeXml([environment.cpuModel, environment.cpuCount ? `${environment.cpuCount} threads` : ""].filter(Boolean).join(" · "))}</td><td>${escapeXml(environment.buildMode ?? "unknown")}</td><td>${escapeXml(environment.cliArtifact ?? "unknown")}</td></tr>`).join("")}</tbody></table></div></section>` : "";
  const profilesPanel = `<section class="panel"><h2>Profile and browser captures</h2><p>Capture artifacts are listed with their recorded environment and build mode.</p>${captureTable(trend, baseDir)}</section>`;
  const style = `:root{--bg:#f6f8fb;--panel:#fff;--ink:#17202a;--muted:#627084;--line:#dde3ea;--blue:#0b6bcb;--green:#16794a;--red:#c2412d;--amber:#a15c00;--radius:12px}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}.page{max-width:1440px;margin:0 auto;padding:28px 24px 60px}.page-head{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:20px}h1{font-size:28px;margin:0 0 4px}h2{font-size:20px;margin:0}h3{font-size:15px;margin:0}.lede{color:var(--muted);max-width:980px;margin:0}.meta{color:var(--muted);font-size:12px;text-align:right;white-space:nowrap}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0}.kpi{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:12px 14px;box-shadow:0 1px 2px rgba(16,24,40,.04)}.kpi span{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em}.kpi strong{display:block;font-size:24px;line-height:1.2;margin:4px 0 2px;font-variant-numeric:tabular-nums}.kpi small{color:var(--muted);font-size:11px}.kpi.bad strong{color:var(--red)}.kpi.good strong{color:var(--green)}.kpi.warn strong{color:var(--amber)}.toolbar{display:flex;flex-wrap:wrap;gap:12px;align-items:end;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:12px 14px;margin:10px 0 22px;position:sticky;top:0;z-index:5;box-shadow:0 2px 8px rgba(16,24,40,.06)}.toolbar label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted)}.toolbar label.check{flex-direction:row;align-items:center;gap:6px;color:var(--ink);padding-bottom:6px}.toolbar select,.toolbar input,.toolbar button{font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:#fff}.toolbar input[type=search]{min-width:240px}.toolbar button{cursor:pointer}.hint{color:var(--muted);font-size:12px;margin:-14px 0 18px}#filter-count{margin-left:auto;color:var(--muted);font-size:12px;padding-bottom:8px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:18px;margin:18px 0;box-shadow:0 1px 2px rgba(16,24,40,.04)}.section-head{display:flex;justify-content:space-between;gap:16px;align-items:baseline;margin-bottom:12px}.section-head p,.panel>p{color:var(--muted);margin:0;max-width:1000px}.legend{display:flex;gap:16px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin-top:8px}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px}.chart-wrap{overflow-x:auto}.chart-wrap svg{min-width:760px}.trend-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px}.trend-card{border:1px solid var(--line);border-radius:10px;padding:12px;background:#fff}.trend-card header{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.trend-card header p{color:var(--muted);font-size:12px;margin:2px 0 0}.trend-card svg{width:100%;height:auto;margin-top:6px}.mini-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:8px 0 0;padding-top:8px;border-top:1px solid var(--line)}.mini-stats div{min-width:0}.mini-stats dt{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.04em}.mini-stats dd{margin:0;font-size:12px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.badge{display:inline-block;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:600;white-space:nowrap;background:#eef2f6;color:#52606d}.badge.regression{background:#fbe4df;color:var(--red)}.badge.improvement{background:#e2f4ea;color:var(--green)}.badge.stable{background:#eef2f6;color:#52606d}.table-wrap{overflow:auto;max-height:640px;border:1px solid var(--line);border-radius:8px}table{border-collapse:separate;border-spacing:0;width:100%;font-size:12px}th,td{padding:7px 9px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;white-space:nowrap}th{position:sticky;top:0;background:#f2f5f9;z-index:1;font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#52606d}th[data-sort]{cursor:pointer;user-select:none}th[data-sort]::after{content:"↕";margin-left:4px;color:#94a3b8}th[data-dir=asc]::after{content:"▲"}th[data-dir=desc]::after{content:"▼"}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}tbody tr:hover{background:#f7fbff}td .sub{display:block;color:var(--muted);font-size:10px}.heat{font-weight:600}.hotspot-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-bottom:16px}.hotspot{border:1px solid var(--line);border-radius:10px;padding:12px;background:#fff}.hotspot h3{margin-bottom:8px}.hotspot ol{margin:0;padding-left:18px}.hotspot li{margin:4px 0;font-size:12px}.hotspot .value{font-weight:600;font-variant-numeric:tabular-nums}.empty{color:var(--muted);margin:8px 0}.spark{width:110px;height:24px;vertical-align:middle}.pill{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:1px 7px;font-size:10px;color:var(--muted)}details.panel>summary{cursor:pointer;font-weight:600;color:var(--ink)}footer.note{color:var(--muted);font-size:12px;margin-top:24px}@media(max-width:900px){.page{padding:16px}.page-head{flex-direction:column}.meta{text-align:left}.kpis{grid-template-columns:repeat(2,1fr)}.toolbar{position:static}.trend-grid{grid-template-columns:1fr}}`;
  const sessionEnd = summary.newestRunAt ? String(summary.newestRunAt) : "";
  const sessionWindow = summary.currentFrom && sessionEnd
    ? ` Current session: ${String(summary.currentFrom).replace("T", " ").slice(0, 16)}–${(sessionEnd.includes("T") ? sessionEnd.slice(11, 16) : sessionEnd.slice(0, 10))} UTC.`
    : "";
  const summaryText = `${summary.cases ?? trend.series.length} current cases · ${trend.runCount} benchmark runs · ${trend.profileRunCount} profile records · ${trend.environmentSeriesCount} environment series.${sessionWindow} Points show median fork time and min–max fork medians in milliseconds.`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Benchmark trends</title><style>${style}</style></head><body><div class="page">
<header class="page-head"><div><h1>Benchmark trends</h1><p class="lede">${escapeXml(summaryText)} The report separates recorded run outcomes from the render, ranks the latest change per case, and keeps the distribution, GC, heap, and CPU columns next to the median.</p></div><div class="meta">Generated ${escapeXml(String(trend.createdAt ?? "").replace("T", " ").slice(0, 19))}<br>${escapeXml(`${trend.environmentSeriesCount} environment series`)}</div></header>
<section class="kpis">${kpis}</section>
${toolbar(trend)}
${changesPanel}
${hotspot}
${trendsPanel}
${distributionPanel}
${latestPanel}
${environmentPanel}
${historyTable(trend, baseDir)}
${profilesPanel}
${statusSection(trend, baseDir)}
<footer class="note">Change thresholds match bench:compare (${CHANGE_RELATIVE_PERCENT}% relative and ${CHANGE_ABSOLUTE_MS} ms absolute). GC time is the sum of recorded pauses divided by measured iterations; heap is the peak sampled heap, not retained size. Profiles and captures are linked relative to this report. The embedded JSON is the same trend data the tables are built from.</footer>
<script type="application/json" id="trend-data">${JSON.stringify(embedTrend(trend, baseDir)).replaceAll("<", "\\u003c")}</script>
${script()}
</div></body></html>`;
}
