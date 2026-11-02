import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acknowledgeDiagnostic,
  auditOutputPackage,
  compareIgRgbaFrames,
  compareVmTraces,
  computePayloadFingerprint,
  decideDelivery,
  inspectRuntimeUrl,
  isCoverageReportComplete,
  summarizeCoverage,
  validateCompareInput,
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
    files.push({ path, kind: path.endsWith(".html") ? "html" : path.endsWith(".js") ? "runtime" : path.endsWith(".png") ? "graphics" : "asset", byteLength: String(bytes.byteLength), sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const fingerprint = createHash("sha256");
  for (const file of files.slice().sort((a, b) => a.path.localeCompare(b.path, "en"))) fingerprint.update(file.path, "utf8").update("\0").update(file.sha256, "ascii").update("\n");
  await writeFile(join(root, "manifest.json"), JSON.stringify({ schemaVersion: "1.0", mode: "standalone-full", files, payloadFingerprint: fingerprint.digest("hex"), ...extra }));
  return root;
}

describe("offline package audit", () => {
  it("recomputes stable payload fingerprints from listed runtime bytes", async () => {
    const imageName = "assets/海报 %图.png";
    const html = `<img src="assets/%E6%B5%B7%E6%8A%A5%20%25%E5%9B%BE.png"><script src="app.js"></script>`;
    const root = await packageRoot({ "index.html": html, "app.js": "(() => { document.body.dataset.ready = 'yes'; })();", [imageName]: pngSignature });
    await mkdir(join(root, "reports"));
    await writeFile(join(root, "reports", "links.json"), JSON.stringify({ source: "https://example.test/docs" }));
    const result = await auditOutputPackage(root);
    expect(result.checks.filter((check) => check.checkId === "OFFLINE_URL_LOCAL")).toHaveLength(2);
    expect(result.checks.find((check) => check.checkId === "PAYLOAD_FINGERPRINT")?.result).toBe("pass");
    expect(result.payloadFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.checks.some((check) => check.checkId === "OFFLINE_EXTERNAL_URL")).toBe(false);
  });

  it("matches the M0 path-plus-SHA256 fingerprint fixed vector", () => {
    const a = { path: "a.js", byteLength: "1", sha256: "0".repeat(64) };
    const b = { path: "b.js", byteLength: "900", sha256: "1".repeat(64) };
    const expected = "09caebace369909387f5b2c6784a1e7224e88a396d8f04108ccb398940cfe702";
    expect(computePayloadFingerprint([b, a])).toBe(expected);
    expect(computePayloadFingerprint([{ ...a, byteLength: "999999" }, { ...b, byteLength: "0" }])).toBe(expected);
  });

  it("requires a well-formed manifest fingerprint and the listed startup file", async () => {
    const missingFingerprint = await packageRoot({ "index.html": "<main>menu</main>" });
    const missingManifest = JSON.parse(await (await import("node:fs/promises")).readFile(join(missingFingerprint, "manifest.json"), "utf8")) as Record<string, unknown>;
    delete missingManifest.payloadFingerprint;
    await writeFile(join(missingFingerprint, "manifest.json"), JSON.stringify(missingManifest));
    expect((await auditOutputPackage(missingFingerprint)).checks.some((check) => check.checkId === "PAYLOAD_FINGERPRINT_MISSING" && check.result === "fail")).toBe(true);

    for (const value of ["", "not-a-sha256"]) {
      const root = await packageRoot({ "index.html": "<main>menu</main>" }, { payloadFingerprint: value });
      const result = await auditOutputPackage(root);
      expect(result.checks.some((check) => ["PAYLOAD_FINGERPRINT_MISSING", "PAYLOAD_FINGERPRINT_INVALID"].includes(check.checkId) && check.result === "fail")).toBe(true);
    }

    const noIndex = await packageRoot({});
    expect((await auditOutputPackage(noIndex)).checks.some((check) => check.checkId === "PACKAGE_ENTRY_MISSING" && check.result === "fail")).toBe(true);

    const unlistedIndex = await packageRoot({ "index.html": "<main>menu</main>" });
    const manifest = JSON.parse(await (await import("node:fs/promises")).readFile(join(unlistedIndex, "manifest.json"), "utf8")) as { files: Array<{ path: string }> };
    manifest.files = manifest.files.filter((file) => file.path !== "index.html");
    await writeFile(join(unlistedIndex, "manifest.json"), JSON.stringify(manifest));
    const result = await auditOutputPackage(unlistedIndex);
    expect(result.checks.some((check) => check.checkId === "PACKAGE_ENTRY_UNLISTED" && check.result === "fail")).toBe(true);
  });

  it("fails on tampered, missing, and unlisted runtime files", async () => {
    const root = await packageRoot({ "index.html": `<script src="app.js"></script>`, "app.js": "(() => {})();" });
    await writeFile(join(root, "app.js"), "changed");
    await writeFile(join(root, "extra.js"), "(() => {})();");
    const result = await auditOutputPackage(root);
    expect(result.checks.some((check) => check.checkId === "PACKAGE_HASH_MISMATCH" && check.path === "app.js")).toBe(true);
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
    mode: "standalone-full" as const,
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
    expect(decideDelivery({ ...base, mode: "menu-only" }, false)).toMatchObject({ status: "partial", exitCode: 0 });
    expect(decideDelivery({ ...base, mode: "menu-only" }, true)).toMatchObject({ status: "partial", exitCode: 2 });
    const acknowledged = acknowledgeDiagnostic({ severity: "error", code: "UNSUPPORTED", blocksComplete: true }, "reviewer", "accepted for preview");
    expect(acknowledged).toMatchObject({ severity: "error", blocksComplete: true, acknowledged: true });
    expect(decideDelivery({ ...base, diagnostics: [acknowledged] }, true)).toMatchObject({ status: "partial", exitCode: 2 });
    expect(decideDelivery({ ...base, declaredEntryCount: 2, hdmvEntryCount: 0 }, false)).toMatchObject({ status: "failed", exitCode: 1 });
    expect(decideDelivery({ ...base, checks: [{ checkId: "HASH", result: "fail", message: "mismatch" }] }, true)).toMatchObject({ status: "failed", exitCode: 1 });
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
  it("validates deterministic compare inputs without source hashes", () => {
    const input = {
      fixtureId: "synthetic-menu-1",
      sourceLabel: "local synthetic fixture",
      playerProfile: { menuLanguage: "eng", audioLanguage: "eng", subtitleLanguage: "eng", country: "US", region: "A", outputProfile: "portable", videoProfiles: [], audioProfiles: [] },
      initialRegisters: { PSR0: 1 }, stableEntry: "movie-0", seed: 7,
      events: [{ at90k: "0", type: "key", key: "enter" }, { at90k: "90000", type: "media-ended" }],
    };
    expect(validateCompareInput(input)).toBe(true);
    expect(validateCompareInput({ ...input, events: [...input.events].reverse() })).toBe(false);
    expect(validateCompareInput({ ...input, sourceFingerprint: "abc" })).toBe(false);
  });

  it("finds the first semantic trace divergence and ignores wall-clock/session fields", () => {
    const base = [{ pc: 2, registers: { PSR1: 3 }, sessionId: "a", wallClockMs: 50, source: { path: "BDMV/MovieObject.bdmv", instructionIndex: 2 } }];
    expect(compareVmTraces(base, [{ ...base[0]!, sessionId: "b", wallClockMs: 900 }])).toEqual({ equal: true, count: 1 });
    const diff = compareVmTraces(base, [{ ...base[0]!, registers: { PSR1: 4 }, source: { path: "BDMV/MovieObject.bdmv", instructionIndex: 3 } }]);
    expect(diff).toMatchObject({ equal: false, index: 0, differingFields: ["/registers/PSR1", "/source/instructionIndex"] });
  });

  it("compares IG RGBA exactly, including alpha, and separates mismatched frame metadata", () => {
    const reference = { width: 1, height: 1, timestamp90k: "9000", colorSpace: "BT.709", pixels: new Uint8Array([1, 2, 3, 255]) };
    expect(compareIgRgbaFrames(reference, { ...reference, pixels: new Uint8Array([1, 2, 3, 255]) })).toMatchObject({ status: "pass", equalPixels: 1, totalPixels: 1 });
    expect(compareIgRgbaFrames(reference, { ...reference, pixels: new Uint8Array([1, 2, 3, 0]) })).toMatchObject({ status: "fail", firstDifference: { x: 0, y: 0, channel: "a", expected: 255, actual: 0 } });
    expect(compareIgRgbaFrames(reference, { ...reference, timestamp90k: "9001" })).toMatchObject({ status: "not-verified", reason: expect.stringContaining("metadata differ") });
  });
});
