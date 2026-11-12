import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const [inputArgument, outputArgument, ...options] = process.argv.slice(2);
const inputRoot = resolve(inputArgument ?? ".");
const outputRoot = resolve(outputArgument ?? "coverage");
let expectedPackages;
for (let index = 0; index < options.length; index++) {
  if (options[index] === "--expected-packages") {
    const count = Number(options[index + 1]);
    if (!Number.isSafeInteger(count) || count < 1) throw new Error("--expected-packages requires a positive integer");
    expectedPackages = count;
    index++;
  } else {
    throw new Error(`Unknown option: ${options[index]}`);
  }
}

const reportPaths = await findCoverageReports(inputRoot);
if (!reportPaths.length) throw new Error(`No coverage-final.json reports found below ${inputRoot}`);

const packages = [];
for (const reportPath of reportPaths) {
  const packagePath = dirname(dirname(relative(inputRoot, reportPath)));
  const name = packagePath.split(sep).join("/");
  const coverage = JSON.parse(await readFile(reportPath, "utf8"));
  const files = Object.values(coverage);
  packages.push({ name, files: files.length, metrics: summarizeFiles(files) });
}
packages.sort((left, right) => left.name.localeCompare(right.name, "en"));

const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  packageCount: packages.length,
  fileCount: packages.reduce((total, item) => total + item.files, 0),
  overall: summarizePackages(packages),
  packages,
};

await mkdir(outputRoot, { recursive: true });
await writeFile(join(outputRoot, "coverage-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(join(outputRoot, "index.html"), renderHtml(summary));
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, renderMarkdown(summary));
}

process.stdout.write(`Workspace coverage (${packages.length} packages, ${summary.fileCount} source files)\n`);
process.stdout.write(renderTable(packages, summary.overall));
if (expectedPackages !== undefined && packages.length !== expectedPackages) {
  process.stderr.write(`Expected ${expectedPackages} package reports, found ${packages.length}.\n`);
  process.exitCode = 1;
}

async function findCoverageReports(root) {
  const found = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name === "coverage-final.json") found.push(path);
    }
  };
  await visit(root);
  return found;
}

function summarizeFiles(files) {
  const metrics = Object.fromEntries(["statements", "branches", "functions", "lines"].map((name) => [name, { covered: 0, total: 0, pct: 100 }]));
  for (const file of files) {
    addCounts(metrics.statements, Object.values(file.s ?? {}));
    addCounts(metrics.branches, Object.values(file.b ?? {}).flat());
    addCounts(metrics.functions, Object.values(file.f ?? {}));
    const lineHits = new Map();
    for (const [id, location] of Object.entries(file.statementMap ?? {})) {
      const line = location.start.line;
      lineHits.set(line, Math.max(lineHits.get(line) ?? 0, file.s[id] ?? 0));
    }
    addCounts(metrics.lines, [...lineHits.values()]);
  }
  for (const metric of Object.values(metrics)) metric.pct = metric.total ? roundPercent(metric.covered, metric.total) : 100;
  return metrics;
}

function addCounts(metric, hits) {
  for (const count of hits) {
    metric.total++;
    if (count > 0) metric.covered++;
  }
}

function summarizePackages(items) {
  const result = Object.fromEntries(["statements", "branches", "functions", "lines"].map((name) => [name, { covered: 0, total: 0, pct: 100 }]));
  for (const item of items) {
    for (const [name, metric] of Object.entries(item.metrics)) {
      result[name].covered += metric.covered;
      result[name].total += metric.total;
    }
  }
  for (const metric of Object.values(result)) metric.pct = metric.total ? roundPercent(metric.covered, metric.total) : 100;
  return result;
}

function roundPercent(covered, total) { return Math.round(covered / total * 10_000) / 100; }
function formatMetric(metric) { return `${metric.pct.toFixed(2)}%`; }

function renderTable(items, overall) {
  const lines = [
    "Package                 Statements  Branches  Functions  Lines",
    `Workspace total         ${formatMetric(overall.statements).padStart(10)}  ${formatMetric(overall.branches).padStart(8)}  ${formatMetric(overall.functions).padStart(9)}  ${formatMetric(overall.lines).padStart(6)}`,
  ];
  for (const item of items) lines.push(`${item.name.padEnd(23)} ${formatMetric(item.metrics.statements).padStart(10)}  ${formatMetric(item.metrics.branches).padStart(8)}  ${formatMetric(item.metrics.functions).padStart(9)}  ${formatMetric(item.metrics.lines).padStart(6)}`);
  return `${lines.join("\n")}\n`;
}

function renderMarkdown(summary) {
  const metricNames = ["statements", "branches", "functions", "lines"];
  const row = (name, files, metrics) =>
    `| ${name} | ${files} | ${metricNames.map((key) => `${formatMetric(metrics[key])} (${metrics[key].covered}/${metrics[key].total})`).join(" | ")} |`;
  return [
    "## Workspace coverage",
    "",
    `${summary.packageCount} packages · ${summary.fileCount} source files · generated ${summary.generatedAt}`,
    "",
    "| Package | Files | Statements | Branches | Functions | Lines |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    row("**Workspace total**", summary.fileCount, summary.overall),
    ...summary.packages.map((item) => row(item.name, item.files, item.metrics)),
    "",
  ].join("\n");
}

function renderHtml(summary) {
  const headers = ["Package", "Files", "Statements", "Branches", "Functions", "Lines"];
  const row = (name, files, metrics, total = false) => `<tr${total ? ' class="total"' : ""}><th scope="row">${escapeHtml(name)}</th><td>${files}</td>${Object.values(metrics).map((metric) => `<td>${formatMetric(metric)} <span>${metric.covered}/${metric.total}</span></td>`).join("")}</tr>`;
  const rows = [row("Workspace total", summary.fileCount, summary.overall, true), ...summary.packages.map((item) => row(item.name, item.files, item.metrics))].join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Workspace coverage</title>
  <style>
    :root { color-scheme: light dark; font: 15px/1.5 system-ui, sans-serif; }
    body { margin: 2rem auto; padding: 0 1rem; max-width: 1100px; }
    h1 { margin-bottom: .25rem; }
    .meta { color: #777; margin-top: 0; }
    .overall { display: grid; grid-template-columns: repeat(4, 1fr); gap: .75rem; margin: 1.5rem 0; }
    .card { border: 1px solid #8885; border-radius: .5rem; padding: .8rem 1rem; }
    .card strong { display: block; font-size: 1.4rem; }
    .card span, td span { color: #777; font-size: .85em; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid #8885; padding: .6rem .7rem; text-align: right; white-space: nowrap; }
    th:first-child, td:first-child { text-align: left; }
    thead th { border-bottom-width: 2px; }
    .total { background: #8882; }
    @media (max-width: 760px) { body { overflow-x: auto; } .overall { grid-template-columns: repeat(2, 1fr); } }
  </style>
</head>
<body>
  <h1>Workspace coverage</h1>
  <p class="meta">${summary.packageCount} packages · ${summary.fileCount} source files · generated ${escapeHtml(summary.generatedAt)}</p>
  <section class="overall" aria-label="Overall coverage">
    ${Object.entries(summary.overall).map(([name, metric]) => `<div class="card"><span>${escapeHtml(name)}</span><strong>${formatMetric(metric)}</strong><span>${metric.covered} / ${metric.total}</span></div>`).join("\n    ")}
  </section>
  <table>
    <thead><tr>${headers.map((header) => `<th scope="col">${header}</th>`).join("")}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>
`;
}

function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
