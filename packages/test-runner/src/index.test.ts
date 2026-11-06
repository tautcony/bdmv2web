import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DeliveryStatus } from "./types.js";
import type { StageStatus } from "./decisions.js";
import {
  acknowledgeDiagnostic,
  auditOutputPackage,
  classifyDiagnostics,
  compareIgRgbaFrames,
  compareVmTraces,
  createDependencyAuditReport,
  decideDelivery,
  decideStageOutcome,
  inspectRuntimeUrl,
  isCoverageReportComplete,
  summarizeCoverage,
  validateCompareInput,
  videoQualityNote,
} from "./index.js";

const roots: string[] = [];
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function packageRoot(payload: Record<string, string | Uint8Array>, extra: Record<string, unknown> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bdmv-m6-") );
  roots.push(root);
  const files = [];
  for (const [path, content] of Object.entries(payload)) {
    const target = join(root, path);
    await mkdir(join(target, ".."), { recursive: true });
    const bytes = typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
    await writeFile(target, bytes);
    files.push({ path, kind: path.endsWith(".html") ? "html" : path.endsWith(".js") ? "runtime" : path.endsWith(".png") ? "graphics" : "asset", byteLength: String(bytes.byteLength) });
  }
  await writeFile(join(root, "manifest.json"), JSON.stringify({ schemaVersion: "1.0", files, ...extra }));
  return root;
}

describe("offline package audit", () => {
  it("builds a dependency audit from concrete checks and leaves an empty audit unverified", () => {
    const base = { schemaVersion: "1.0" as const, packageRoot: "/package", manifestPath: "manifest.json", discoveredPayloadFiles: [] };
    expect(createDependencyAuditReport({ ...base, checks: [
      { checkId: "OFFLINE_URL_LOCAL", result: "pass", message: "Local asset resolves", path: "index.html", evidence: { target: "assets/menu.png" } },
    ] })).toMatchObject({ status: "pass", checks: [{ path: "index.html", evidence: { target: "assets/menu.png" } }] });
    expect(createDependencyAuditReport({ ...base, checks: [
      { checkId: "BUNDLE_NETWORK_API", result: "fail", message: "Network API found", path: "app.js", evidence: { expression: "fetch(...)" } },
    ] })).toMatchObject({ status: "fail", checks: [{ result: "fail", path: "app.js", evidence: { expression: "fetch(...)" } }] });
    expect(createDependencyAuditReport({ ...base, checks: [
      { checkId: "BUNDLE_DYNAMIC_ACCESS", result: "not-verified", message: "Computed access", path: "app.js", evidence: { expression: "window[key]" } },
    ] })).toMatchObject({ status: "not-verified", checks: [{ result: "not-verified", evidence: { expression: "window[key]" } }] });
    expect(createDependencyAuditReport({ ...base, checks: [] })).toMatchObject({ status: "not-verified", checks: [] });
  });

  it("audits listed runtime files", async () => {
    const imageName = "assets/海报 %图.png";
    const html = `<img src="assets/%E6%B5%B7%E6%8A%A5%20%25%E5%9B%BE.png"><script src="app.js"></script>`;
    const root = await packageRoot({ "index.html": html, "app.js": "(() => { document.body.dataset.ready = 'yes'; })();", [imageName]: pngSignature });
    await mkdir(join(root, "reports"));
    await writeFile(join(root, "reports", "links.json"), JSON.stringify({ source: "https://example.test/docs" }));
    const result = await auditOutputPackage(root);
    expect(result.checks.filter((check) => check.checkId === "OFFLINE_URL_LOCAL")).toHaveLength(2);
    expect(result.checks.some((check) => check.checkId === "OFFLINE_EXTERNAL_URL")).toBe(false);
  });

  it("audits HTML, CSS, JSON, and JS URLs while allowing encoded Unicode paths and README links", async () => {
    const imageName = "assets/海报 %图.png";
    const root = await packageRoot({
      "index.html": `<img src="assets/%E6%B5%B7%E6%8A%A5%20%25%E5%9B%BE.png"><link rel="stylesheet" href="style.css"><script src="app.js"></script><script type="application/json" src="runtime.json"></script>`,
      "style.css": `.poster { background-image: url("assets/%E6%B5%B7%E6%8A%A5%20%25%E5%9B%BE.png"); }`,
      "runtime.json": JSON.stringify({ poster: { relativePath: imageName } }),
      "app.js": `const image = new Image(); image.src = "assets/%E6%B5%B7%E6%8A%A5%20%25%E5%9B%BE.png";`,
      [imageName]: pngSignature,
      "README.md": "See https://example.test/docs for package notes.",
    });
    const result = await auditOutputPackage(root);
    expect(result.checks.filter((check) => check.checkId === "OFFLINE_URL_LOCAL").length).toBeGreaterThanOrEqual(5);
    expect(result.checks.some((check) => check.checkId === "OFFLINE_EXTERNAL_URL" || check.checkId === "OFFLINE_URL_ESCAPE")).toBe(false);
  });

  it("requires the listed startup file", async () => {
    const noIndex = await packageRoot({});
    expect((await auditOutputPackage(noIndex)).checks.some((check) => check.checkId === "PACKAGE_ENTRY_MISSING" && check.result === "fail")).toBe(true);

    const unlistedIndex = await packageRoot({ "index.html": "<main>menu</main>" });
    const manifest = JSON.parse(await (await import("node:fs/promises")).readFile(join(unlistedIndex, "manifest.json"), "utf8")) as { files: Array<{ path: string }> };
    manifest.files = manifest.files.filter((file) => file.path !== "index.html");
    await writeFile(join(unlistedIndex, "manifest.json"), JSON.stringify(manifest));
    const result = await auditOutputPackage(unlistedIndex);
    expect(result.checks.some((check) => check.checkId === "PACKAGE_ENTRY_UNLISTED" && check.result === "fail")).toBe(true);
  });

  it("ignores changed file size and fails on missing and unlisted runtime files", async () => {
    const root = await packageRoot({ "index.html": `<script src="app.js"></script>`, "app.js": "(() => {})();" });
    await writeFile(join(root, "app.js"), "changed");
    await writeFile(join(root, "extra.js"), "(() => {})();");
    const result = await auditOutputPackage(root);
    expect(result.checks.some((check) => check.checkId === "PACKAGE_UNLISTED_PAYLOAD" && check.path === "extra.js")).toBe(true);

    const missingRoot = await packageRoot({ "index.html": `<img src="missing.png">` });
    await rm(join(missingRoot, "index.html"));
    const missing = await auditOutputPackage(missingRoot);
    expect(missing.checks.some((check) => check.checkId === "PACKAGE_MISSING_ASSET")).toBe(true);
  });

  it("allows only signature-matching PNG/WAV data URLs and rejects executable MIME", () => {
    const png = `data:image/png;base64,${pngSignature.toString("base64")}`;
    const wavBytes = Buffer.concat([Buffer.from("RIFF"), Buffer.from([4, 0, 0, 0]), Buffer.from("WAVE")]);
    expect(inspectRuntimeUrl(png)).toMatchObject({ ok: true, kind: "data", mime: "image/png" });
    expect(inspectRuntimeUrl(`data:audio/wav;base64,${wavBytes.toString("base64")}`)).toMatchObject({ ok: true, kind: "data", mime: "audio/wav" });
    expect(inspectRuntimeUrl("data:image/svg+xml,<svg/onload=alert(1)>").ok).toBe(false);
    expect(inspectRuntimeUrl("data:text/html,<script>alert(1)</script>").ok).toBe(false);
    expect(inspectRuntimeUrl(`data:image/png;base64,${Buffer.from("not png").toString("base64")}`).ok).toBe(false);
  });

  it("flags runtime module/network/eval APIs and external nested references", async () => {
    const root = await packageRoot({
      "index.html": `<script src="app.js"></script>`,
      "app.js": `import('./x.js'); fetch('https://example.test/a'); eval('x');`,
    });
    const result = await auditOutputPackage(root);
    expect(result.checks.some((check) => check.checkId === "BUNDLE_IMPORT")).toBe(true);
    expect(result.checks.some((check) => check.checkId === "BUNDLE_NETWORK_API")).toBe(true);
    expect(result.checks.some((check) => check.checkId === "BUNDLE_EVAL")).toBe(true);
  });

  it("marks computed network APIs and URL sinks not verified", async () => {
    const root = await packageRoot({
      "index.html": `<script src="app.js"></script>`,
      "app.js": `window['fetch']('https://example.test/a'); element['setAttribute']('src', nextUrl);`,
    });
    const result = await auditOutputPackage(root);
    expect(result.checks.some((check) => check.checkId === "BUNDLE_DYNAMIC_ACCESS" && check.result === "not-verified")).toBe(true);
    expect(result.checks.some((check) => check.checkId === "BUNDLE_DYNAMIC_URL_SINK" && check.result === "not-verified")).toBe(true);
    expect(result.checks.find((check) => check.checkId === "OFFLINE_STATIC_AUDIT")?.result).toBe("not-verified");
  });
});

describe("delivery status and coverage", () => {
  const passing = { checkId: "PACKAGE", result: "pass" as const, message: "ok" };
  const base = {
    checks: [passing],
    declaredEntryCount: 1,
    hdmvEntryCount: 1,
    hasMissingRequiredAsset: false,
    hasUnresolvedReachability: false,
    hasUnsupportedReachableCapability: false,
    requiredEvidenceComplete: true,
    coverageComplete: true,
  };

  it("keeps strict policy separate from status and never upgrades acknowledged errors", () => {
    expect(decideDelivery({ ...base }, false)).toMatchObject({ status: "complete", exitCode: 0 });
    expect(decideDelivery({ ...base }, true)).toMatchObject({ status: "complete", exitCode: 0 });
    expect(decideDelivery({ ...base, hasUnresolvedReachability: true }, false)).toMatchObject({ status: "partial", exitCode: 0 });
    expect(decideDelivery({ ...base, hasUnresolvedReachability: true }, true)).toMatchObject({ status: "partial", exitCode: 2 });
    const acknowledged = acknowledgeDiagnostic({ severity: "error", code: "UNSUPPORTED", blocksComplete: true }, "reviewer", "accepted for preview");
    expect(acknowledged).toMatchObject({ severity: "error", blocksComplete: true, acknowledged: true });
    expect(decideDelivery({ ...base, diagnostics: [acknowledged] }, true)).toMatchObject({ status: "partial", exitCode: 2 });
    expect(decideDelivery({ ...base, declaredEntryCount: 2, hdmvEntryCount: 0 }, false)).toMatchObject({ status: "failed", exitCode: 1 });
    expect(decideDelivery({ ...base, checks: [{ checkId: "ASSET_MISSING", result: "fail", message: "Required asset is missing" }] }, true)).toMatchObject({ status: "failed", exitCode: 1 });
  });

  it.each([
    ["without gaps", { ...base }, false, "complete", 0],
    ["strict without gaps", { ...base }, true, "complete", 0],
    ["mixed HDMV and BD-J entries", { ...base, declaredEntryCount: 2, hdmvEntryCount: 1, hasUnsupportedReachableCapability: true, diagnostics: [{ severity: "warning", code: "BDJ_UNSUPPORTED" }] }, true, "partial", 2],
    ["pure BD-J", { ...base, declaredEntryCount: 1, hdmvEntryCount: 0 }, true, "failed", 1],
    ["unknown opcode", { ...base, checks: [{ checkId: "UNKNOWN_OPCODE", result: "not-verified" as const, message: "Unknown reachable opcode", evidence: { instructionOffset: "24" } }], hasUnresolvedReachability: true, coverageComplete: false, diagnostics: [{ severity: "warning", code: "UNKNOWN_OPCODE" }] }, true, "partial", 2],
    ["missing required media", { ...base, hasMissingRequiredAsset: true }, false, "failed", 1],
    ["missing required evidence", { ...base, requiredEvidenceComplete: false }, true, "complete", 0],
  ])("applies delivery policy to %s", (_label, input, strict, status, exitCode) => {
    expect(decideDelivery(input, strict)).toMatchObject({ status, strict, exitCode });
  });

  it("uses delivery facts to determine status", () => {
    const decision = decideDelivery({ ...base }, false);
    expect(decision.status).toBe("complete");
  });

  it("allows complete delivery with unverified checks and records those evidence gaps", () => {
    const decision = decideDelivery({
      checks: [passing, { checkId: "BROWSER_EVIDENCE", result: "not-verified", message: "not supplied" }],
      diagnostics: [],
      declaredEntryCount: 1,
      hdmvEntryCount: 1,
      hasMissingRequiredAsset: false,
      hasUnresolvedReachability: false,
      hasUnsupportedReachableCapability: false,
      limitations: ["Direct file:// browser acceptance remains unverified"],
    }, true);
    expect(decision).toMatchObject({ status: "complete", strict: true, exitCode: 0 });
    expect(decision.notVerified).toEqual(expect.arrayContaining(["BROWSER_EVIDENCE", "REQUIRED_EVIDENCE_INCOMPLETE", "COVERAGE_INCOMPLETE"]));
    expect(decision.reasons.join(" ")).toContain("Limitation:");
  });

  it("classifies diagnostics by severity and acknowledgement", () => {
    expect(classifyDiagnostics([])).toMatchObject({ hasFatal: false, hasBlockingError: false, blocking: [] });
    expect(classifyDiagnostics(undefined)).toMatchObject({ hasFatal: false, hasBlockingError: false, blocking: [] });
    const fatal = classifyDiagnostics([{ severity: "fatal", code: "BDMV_REQUIRED_FILE_MISSING" }]);
    expect(fatal).toMatchObject({ hasFatal: true, hasBlockingError: true });
    expect(fatal.blocking).toHaveLength(1);
    const error = classifyDiagnostics([{ severity: "error", code: "STREAM_TRUNCATED" }]);
    expect(error).toMatchObject({ hasFatal: false, hasBlockingError: true });
    const acknowledged = classifyDiagnostics([acknowledgeDiagnostic({ severity: "error", code: "UNSUPPORTED" }, "reviewer", "accepted")]);
    expect(acknowledged).toMatchObject({ hasFatal: false, hasBlockingError: true });
    expect(classifyDiagnostics([{ severity: "warning", code: "M5_MENU_LOOP_UNAVAILABLE" }])).toMatchObject({ hasFatal: false, hasBlockingError: false, blocking: [] });
  });

  it.each([
    ["fatal", [{ severity: "fatal", code: "BDMV_REQUIRED_FILE_MISSING" }], false, "failed", 1],
    ["fatal under strict", [{ severity: "fatal", code: "BDMV_REQUIRED_FILE_MISSING" }], true, "failed", 1],
    ["error", [{ severity: "error", code: "STREAM_TRUNCATED" }], false, "partial", 0],
    ["error under strict", [{ severity: "error", code: "STREAM_TRUNCATED" }], true, "partial", 2],
    ["acknowledged error", [acknowledgeDiagnostic({ severity: "error", code: "UNSUPPORTED" }, "reviewer", "accepted")], false, "partial", 0],
    ["no diagnostics", [], false, "complete", 0],
  ])("decides the stage outcome for %s", (_label, diagnostics, strict, status, exitCode) => {
    const outcome = decideStageOutcome({ stage: "extract", diagnostics, strict });
    expect(outcome).toMatchObject({ status, strict, exitCode });
    expect(outcome.blockingDiagnostics).toHaveLength(status === "complete" ? 0 : 1);
  });

  it("keeps delivery status and stage status mutually unassignable", () => {
    const outcome = decideStageOutcome({ stage: "inspect", diagnostics: [], strict: false });
    expect(outcome).toMatchObject({ status: "complete", exitCode: 0, blockingDiagnostics: [] });
    // No checks were supplied: that is missing evidence, not a failure (D-2R).
    const delivery = decideDelivery({ checks: [], diagnostics: [] }, false);
    expect(delivery.status).toBe("complete");
    expect(delivery.notVerified).toEqual(expect.arrayContaining(["NO_AUDIT_CHECKS", "REQUIRED_EVIDENCE_INCOMPLETE"]));

    // @ts-expect-error a delivery status must not be usable where a stage status is required
    const stageFromDelivery: StageStatus = delivery.status;
    // @ts-expect-error a stage status must not be usable where a delivery status is required
    const deliveryFromStage: DeliveryStatus = outcome.status;

    expect(stageFromDelivery).toBe("complete");
    expect(deliveryFromStage).toBe("complete");
  });

  it("does not turn zero/unknown denominators or missing evidence into 100 percent", () => {
    expect(summarizeCoverage({ total: 0, reason: "No media paths" })).toMatchObject({ status: "N/A", percent: null, complete: false });
    expect(summarizeCoverage({ passed: 8 })).toMatchObject({ status: "N/A", percent: null, complete: false });
    expect(summarizeCoverage({ total: 3, passed: 3, evidenceComplete: false })).toMatchObject({ percent: null, complete: false });
    expect(summarizeCoverage({ total: 3, passed: 3, evidenceComplete: true })).toMatchObject({ status: "measured", percent: 100, complete: true });
    const report = { empty: summarizeCoverage({ total: 0, reason: "Not applicable" }) };
    expect(isCoverageReportComplete(report)).toBe(true);
    expect(isCoverageReportComplete({ unknown: summarizeCoverage({ passed: 8 }) })).toBe(false);
    expect(isCoverageReportComplete({ zeroWithoutReason: { ...report.empty, reason: "  " } })).toBe(false);
    expect(isCoverageReportComplete({})).toBe(false);
  });
});

describe("reference comparison primitives", () => {
  it("validates deterministic compare inputs", () => {
    const input = {
      fixtureId: "synthetic-menu-1",
      sourceLabel: "local synthetic fixture",
      playerProfile: { menuLanguage: "eng", audioLanguage: "eng", subtitleLanguage: "eng", country: "US", region: "A", outputProfile: "portable", videoProfiles: [], audioProfiles: [] },
      initialRegisters: { PSR0: 1 }, stableEntry: "movie-0", seed: 7,
      events: [{ at90k: "0", type: "key", key: "enter" }, { at90k: "90000", type: "media-ended" }],
    };
    expect(validateCompareInput(input)).toBe(true);
    expect(validateCompareInput({ ...input, events: [...input.events].reverse() })).toBe(false);
  });

  it("finds the first semantic trace divergence and ignores wall-clock/session fields", () => {
    const base = [{ pc: 2, registers: { PSR1: 3 }, sessionId: "a", wallClockMs: 50, source: { path: "BDMV/MovieObject.bdmv", instructionIndex: 2 } }];
    expect(compareVmTraces(base, [{ ...base[0]!, sessionId: "b", wallClockMs: 900 }])).toEqual({ equal: true, count: 1 });
    const diff = compareVmTraces(base, [{ ...base[0]!, registers: { PSR1: 4 }, source: { path: "BDMV/MovieObject.bdmv", instructionIndex: 3 } }]);
    expect(diff).toMatchObject({ equal: false, index: 0, differingFields: ["/registers/PSR1", "/source/instructionIndex"] });
    const controlDiff = compareVmTraces([{ pc: 2, stack: [{ programId: 1, returnPc: 4 }], action: { type: "PLAY_PL", playlistId: 3 }, source: { path: "MovieObject.bdmv", offset: "24" } }], [{ pc: 3, stack: [{ programId: 1, returnPc: 5 }], action: { type: "PLAY_PL", playlistId: 4 }, source: { path: "MovieObject.bdmv", offset: "36" } }]);
    expect(controlDiff).toMatchObject({ equal: false, differingFields: ["/action/playlistId", "/pc", "/source/offset", "/stack/0/returnPc"] });
  });

  it("compares IG RGBA exactly, including alpha, and separates mismatched frame metadata", () => {
    const reference = { width: 1, height: 1, timestamp90k: "9000", colorSpace: "BT.709", pixels: new Uint8Array([1, 2, 3, 255]) };
    expect(compareIgRgbaFrames(reference, { ...reference, pixels: new Uint8Array([1, 2, 3, 255]) })).toMatchObject({ status: "pass", equalPixels: 1, totalPixels: 1 });
    expect(compareIgRgbaFrames(reference, { ...reference, pixels: new Uint8Array([1, 2, 3, 0]) })).toMatchObject({ status: "fail", firstDifference: { x: 0, y: 0, channel: "a", expected: 255, actual: 0 } });
    expect(compareIgRgbaFrames(reference, { ...reference, timestamp90k: "9001" })).toMatchObject({ status: "not-verified", reason: expect.stringContaining("metadata differ") });
    expect(compareIgRgbaFrames({ width: 2, height: 1, timestamp90k: "9000", colorSpace: "BT.709", pixels: new Uint8Array([0, 0, 0, 255, 10, 20, 30, 255]) }, { width: 2, height: 1, timestamp90k: "9000", colorSpace: "BT.709", pixels: new Uint8Array([0, 0, 0, 255, 10, 20, 40, 255]) })).toMatchObject({ status: "fail", equalPixels: 1, totalPixels: 2, firstDifference: { x: 1, y: 0, channel: "b", expected: 30, actual: 40 } });
    expect(videoQualityNote()).toMatchObject({ category: "video-quality", status: "not-verified" });
  });
});
