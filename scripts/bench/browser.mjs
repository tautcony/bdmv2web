import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Option } from "commander";
import { BUILD_MODES } from "./build-mode.mjs";
import { createProgram, exitWithError, parseOptions } from "./cli.mjs";

function skip(reason, cause) {
  const error = new Error(reason, cause ? { cause } : undefined);
  error.name = "BenchmarkSkipError";
  error.code = "BENCH_SKIP";
  return error;
}

async function loadPlaywright() {
  try { return await import("playwright"); }
  catch (error) { throw skip(`Browser scenario skipped: Playwright is unavailable (${error instanceof Error ? error.message : String(error)})`, error); }
}

export async function buildSyntheticPackage(root, output) {
  const builderPath = resolve(root, "packages/package-builder/dist/index.js");
  const graphicsPath = resolve(root, "packages/igs/dist/png.js");
  const [{ buildMenuPackage }, { encodeRgbaPng }] = await Promise.all([
    import(pathToFileURL(builderPath).href), import(pathToFileURL(graphicsPath).href),
  ]);
  const ir = { schemaVersion: "1.0", entries: [], programs: [], menus: [], playlists: [], mediaAssets: [], diagnostics: [] };
  const solid = (r, g, b) => {
    const rgba = new Uint8Array(64 * 32 * 4);
    for (let offset = 0; offset < rgba.length; offset += 4) { rgba[offset] = r; rgba[offset + 1] = g; rgba[offset + 2] = b; rgba[offset + 3] = 255; }
    return encodeRgbaPng(64, 32, rgba);
  };
  const button = (id, x, neighborLeft, neighborRight) => ({
    id, bog: 0, enabled: true, neighbors: { up: id, down: id, left: neighborLeft, right: neighborRight },
    states: {
      normal: { bounds: { x, y: 100, width: 500, height: 300 }, assetId: "normal" },
      selected: { bounds: { x, y: 100, width: 500, height: 300 }, assetId: "selected" },
    }, commands: [],
  });
  const scene = { width: 1920, height: 1080, pages: [{
    id: 0, defaultButtonId: 1,
    buttons: [button(1, 100, 2, 2), button(2, 700, 1, 1)],
  }] };
  await buildMenuPackage({
    outputDirectory: output, title: "Synthetic browser performance menu", ir, scene, graphics: [
      { id: "normal", bytes: solid(24, 88, 184) }, { id: "selected", bytes: solid(224, 48, 32) },
    ], status: "partial", runtimeVersion: "0.1.0",
    diagnostics: [{ code: "BENCH_SYNTHETIC_FIXTURE", message: "Generated two-button menu for local browser capture." }],
  });
  const manifestPath = join(output, "manifest.json");
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); }
  catch (error) { throw new Error(`Generated browser package has no readable manifest.json: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  if (manifest.status !== "partial") throw new Error(`Generated browser package status is ${String(manifest.status)}`);
  return { destination: output, manifest, packageBuilder: "buildMenuPackage" };
}

function readPageEvidence(page) {
  return page.evaluate(() => {
    const doc = globalThis.document;
    const data = globalThis.__BDMV_MENU_DATA__;
    const scene = data?.scene;
    const buttons = scene?.pages?.flatMap((page) => page.buttons ?? []) ?? [];
    const canvas = doc.getElementById("menu-canvas");
    const status = doc.getElementById("runtime-status");
    return {
      title: doc.title,
      readyState: doc.readyState,
      startButtonVisible: doc.getElementById("start-menu")?.hidden === false,
      sceneCount: scene?.pages?.length ?? 0,
      buttonCount: buttons.length,
      canvasWidth: canvas?.width ?? 0,
      canvasHeight: canvas?.height ?? 0,
      status: status?.textContent?.trim() ?? "",
      pixels: canvas instanceof globalThis.HTMLCanvasElement ? canvas.toDataURL() : "",
    };
  });
}

async function readTraceStream(session, handle) {
  const chunks = [];
  for (;;) {
    const result = await session.send("IO.read", { handle });
    chunks.push(result.data ?? "");
    if (result.eof) break;
  }
  await session.send("IO.close", { handle });
  return chunks.join("");
}

async function captureBrowserNavigation(browser, fileUrl, artifactPrefix, captureProfiles) {
  const context = await browser.newContext({ acceptDownloads: false, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  const consoleMessages = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleMessages.push(message.text()); });
  let cdp;
  let traceTimeout;
  let traceDone;
  try {
    if (captureProfiles) {
      cdp = await context.newCDPSession(page);
      traceDone = new Promise((resolveTrace, rejectTrace) => {
        cdp.once("Tracing.tracingComplete", (event) => { clearTimeout(traceTimeout); resolveTrace(event.stream); });
        traceTimeout = setTimeout(() => rejectTrace(new Error("Browser trace completion timed out")), 10_000);
      });
      traceDone.catch(() => {});
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.start");
      await cdp.send("Tracing.start", {
        transferMode: "ReturnAsStream",
        categories: "devtools.timeline,v8,blink.user_timing,disabled-by-default-v8.cpu_profiler",
      });
    }
    const navigationStarted = performance.now();
    await page.goto(fileUrl, { waitUntil: "load", timeout: 30_000 });
    await page.waitForSelector("#menu-canvas", { timeout: 10_000 });
    await page.waitForFunction(() => globalThis.document.getElementById("runtime-status")?.textContent?.includes("Images decoded"), null, { timeout: 10_000 });
    const initial = await readPageEvidence(page);
    if (!initial.buttonCount) throw new Error("Generated file:// package loaded without menu buttons");
    if (!initial.startButtonVisible) throw new Error("Generated menu did not expose its preview start control");
    await page.click("#start-menu");
    await page.waitForFunction(() => globalThis.document.getElementById("start-menu")?.hidden === true, null, { timeout: 5_000 });
    await page.evaluate(() => new Promise((resolveFrame) => globalThis.requestAnimationFrame(() => resolveFrame())));
    const started = await readPageEvidence(page);
    await page.keyboard.press("ArrowRight");
    await page.evaluate(() => new Promise((resolveFrame) => globalThis.requestAnimationFrame(() => resolveFrame())));
    const afterMove = await readPageEvidence(page);
    await page.keyboard.press("Enter");
    await page.evaluate(() => new Promise((resolveFrame) => globalThis.requestAnimationFrame(() => resolveFrame())));
    const final = await readPageEvidence(page);
    const navigationStateChanged = started.pixels !== afterMove.pixels || afterMove.pixels !== final.pixels;
    if (!navigationStateChanged) throw new Error("file:// keyboard navigation did not change the menu canvas after starting the preview and sending ArrowRight/Enter");
    let artifacts = null;
    if (captureProfiles) {
      const cpu = await cdp.send("Profiler.stop");
      await cdp.send("Tracing.end");
      const stream = await traceDone;
      const trace = await readTraceStream(cdp, stream);
      await mkdir(join(artifactPrefix, "browser"), { recursive: true });
      const cpuPath = join(artifactPrefix, "browser", "navigation.cpuprofile");
      const tracePath = join(artifactPrefix, "browser", "navigation.trace.json");
      await writeFile(cpuPath, `${JSON.stringify(cpu.profile)}\n`);
      await writeFile(tracePath, trace);
      artifacts = { cpuProfile: cpuPath, trace: tracePath };
    }
    if (errors.length) throw new Error(`Browser page errors: ${errors.join(" | ")}`);
    return {
      status: "complete", fileUrl, elapsedMs: performance.now() - navigationStarted,
      interaction: "Start menu preview, then ArrowRight and Enter", navigationStateChanged, startButtonHidden: !final.startButtonVisible, sceneCount: final.sceneCount, buttonCount: final.buttonCount,
      canvas: { width: final.canvasWidth, height: final.canvasHeight }, pageErrors: errors,
      consoleErrors: consoleMessages, artifacts, browserVersion: browser.version(),
    };
  } finally {
    if (traceTimeout) clearTimeout(traceTimeout);
    if (cdp) {
      await cdp.send("Profiler.stop").catch(() => {});
      await cdp.send("Tracing.end").catch(() => {});
      await cdp.detach().catch(() => {});
    }
    await context.close().catch(() => {});
  }
}

export async function prepareBrowserScenario(caseDef, root) {
  const captureProfiles = caseDef.options.collectProfiles === true;
  const playwright = await loadPlaywright();
  let browser;
  try { browser = await playwright.chromium.launch({ headless: true, args: ["--allow-file-access-from-files"] }); }
  catch (error) { throw skip(`Browser scenario skipped: Chromium is unavailable (${error instanceof Error ? error.message : String(error)})`, error); }
  await browser.close();
  const outputRoot = caseDef.options.artifactDirectory
    ? resolve(root, caseDef.options.artifactDirectory)
    : resolve(root, "test-data/bench/profiles");
  await mkdir(outputRoot, { recursive: true });
  const artifacts = caseDef.options.artifactDirectory ? outputRoot : captureProfiles ? await mkdtemp(join(outputRoot, "browser-file-url-")) : null;
  const packageDirectory = await mkdtemp(join(tmpdir(), "bdmv2web-bench-browser-"));
  const packageInfo = await buildSyntheticPackage(root, packageDirectory);
  const fileUrl = pathToFileURL(join(packageInfo.destination, "index.html")).href;
  let sequence = 0;
  const run = async () => {
    // One fresh browser per sample; CDP CPU and trace capture only in dedicated browser mode.
    const currentBrowser = await playwright.chromium.launch({ headless: true, args: ["--allow-file-access-from-files"] });
    try {
      const currentPrefix = artifacts ? join(artifacts, `sample-${sequence++}`) : outputRoot;
      return await captureBrowserNavigation(currentBrowser, fileUrl, currentPrefix, captureProfiles);
    } finally { await currentBrowser.close(); }
  };
  return {
    input: { urlScheme: "file", packageBuilder: packageInfo.packageBuilder, generatedPackageStatus: packageInfo.manifest.status },
    fixture: caseDef.fixture,
    scope: captureProfiles ? "file-url-navigation-with-cdp-cpu-and-performance-trace" : "file-url-navigation-and-keyboard-interaction",
    run,
    validate: (result) => { if (result.status !== "complete" || !result.navigationStateChanged || !result.startButtonHidden) throw new Error("Browser file:// navigation did not complete"); return { browserVersion: result.browserVersion, interaction: result.interaction }; },
    describe: (result) => ({ summary: `Chromium ${result.browserVersion} opened file:// and completed keyboard menu navigation`, details: { elapsedMs: result.elapsedMs, interaction: result.interaction, navigationStateChanged: result.navigationStateChanged, sceneCount: result.sceneCount, buttonCount: result.buttonCount, canvas: result.canvas } }),
    afterMeasurement: async () => { const { rm } = await import("node:fs/promises"); await rm(packageDirectory, { recursive: true, force: true }); if (!caseDef.options.artifactDirectory && artifacts) await rm(artifacts, { recursive: true, force: true }); },
  };
}


function createBrowserCommand() {
  return createProgram("bench-browser", "Capture one Chromium file:// navigation with optional CPU profile and trace.")
    .option("--case <caseId>", "browser case ID", "browser.synthetic-menu.file-navigation")
    .option("--root <dir>", "code root", fileURLToPath(new URL("../..", import.meta.url)))
    .option("--fixture-root <dir>", "fixture root")
    .option("--out <dir>", "output root", "test-data/bench/runs")
    .addOption(new Option("--build-mode <mode>", "declared build mode").choices(BUILD_MODES))
    .option("--mode <mode>", "measurement mode forwarded by the benchmark runner");
}

async function main(argv) {
  const options = parseOptions(createBrowserCommand(), argv);
  const root = resolve(options.root);
  const fixtureRoot = resolve(options.fixtureRoot ?? root);
  const buildMode = options.buildMode;
  const caseId = options.case;
  const { getCaseDefinitions } = await import("./cases.mjs");
  const { prepareScenarioCase } = await import("./scenarios.mjs");
  const definition = (await getCaseDefinitions({ root, fixtureRoot })).find((item) => item.caseId === caseId);
  if (!definition || definition.category !== "browser") throw new Error(`Unknown browser case ID: ${caseId}`);
  const outputRoot = options.out;
  const { createProfileRunDirectory, profilePath, writeProfileRun } = await import("./profile-record.mjs");
  const { runId, runDir } = await createProfileRunDirectory(root, outputRoot);
  definition.options = { ...definition.options, artifactDirectory: runDir, collectProfiles: true };
  const prepared = await prepareScenarioCase(definition, root);
  if (prepared.skip) {
    await rm(runDir, { recursive: true, force: true });
    process.stdout.write(`${JSON.stringify({ status: "skipped", mode: "browser", caseId, reason: prepared.skip })}\n`);
    return;
  }
  try {
    const startedAt = new Date().toISOString();
    const result = await prepared.run();
    const summary = prepared.describe(result);
    const artifacts = [result.artifacts?.cpuProfile, result.artifacts?.trace].filter(Boolean).map((file) => profilePath(runDir, file).relativePath);
    const row = { caseId, fixture: definition.fixture, category: definition.category, name: definition.name, sample: definition.sample, scope: prepared.scope, artifacts, forks: [{ index: 0, wallMs: result.elapsedMs, browserVersion: result.browserVersion, output: summary }] };
    await writeProfileRun({ root, outputRoot, mode: "browser", definition, configuration: { caseId, startedAt, interaction: result.interaction, profile: true, samples: 1 }, row, buildMode, runDir, runId });
    process.stdout.write(`${JSON.stringify({ status: "complete", mode: "browser", caseId, runId, runDirectory: runDir, record: join(runDir, "run.json"), scope: prepared.scope, input: prepared.input, output: summary, result })}\n`);
  } finally { await prepared.afterMeasurement?.(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { exitWithError(error, error?.code === "BENCH_SKIP" ? 0 : 1, { stack: true }); });
}
