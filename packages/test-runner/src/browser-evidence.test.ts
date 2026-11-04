import { describe, expect, it } from "vitest";
import { createBrowserEvidence, createBrowserEvidenceBinding, evaluateBrowserEvidence, evaluateBrowserEvidenceMatrix } from "./browser-evidence.js";
import { decideDelivery } from "./decisions.js";
import type { BrowserEvidenceContext } from "./browser-evidence.js";

const context: BrowserEvidenceContext = {
  payloadFingerprint: "a".repeat(64),
  mode: "standalone-full",
  profile: { audioLanguage: "eng", outputProfile: "portable", region: "A" },
  generatedFiles: [
    { path: "media/background.mp4", kind: "media", byteLength: "120", sha256: "b".repeat(64) },
    { path: "assets/sound.wav", kind: "audio", byteLength: "64", sha256: "c".repeat(64) },
    { path: "runtime/app.js", kind: "runtime", byteLength: "20", sha256: "d".repeat(64) },
  ],
  matrix: [{ caseId: "J-file-chrome", expected: { launch: true, offline: true } }],
  environment: { os: "macOS", osBuild: "27.2 (26B123)", browser: "Google Chrome", browserVersion: "156.0.8078.76" },
};

function record(overrides: Partial<BrowserEvidenceContext> = {}) {
  const bindingContext = { ...context, ...overrides };
  return createBrowserEvidence({
    caseId: "J-file-chrome", expected: { launch: true, offline: true }, actual: { launch: true, offline: true },
    result: "pass", observedAt: "2026-11-02T00:00:00Z", environment: bindingContext.environment,
    artifacts: [{ path: "reports/evidence/J-file-chrome/screenshot.png", kind: "screenshot", bytes: new Uint8Array([1, 2, 3]) }],
  }, bindingContext);
}

describe("browser evidence binding", () => {
  it("binds package, generated media, profile, mode, matrix and browser environment", () => {
    const evidence = record();
    expect(evaluateBrowserEvidence(evidence, context)).toMatchObject({ checkId: "BROWSER_EVIDENCE_BINDING", result: "pass" });
    expect(evidence.binding).toMatchObject({ payloadFingerprint: "a".repeat(64), mode: "standalone-full" });
    expect(evidence.binding.generatedMediaFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.binding.profileFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.binding.matrixFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.binding.environmentFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.artifacts[0]).toMatchObject({ path: "reports/evidence/J-file-chrome/screenshot.png", kind: "screenshot", sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  it.each([
    ["profile", { profile: { audioLanguage: "jpn", outputProfile: "portable", region: "A" } }],
    ["mode", { mode: "menu-only" as const }],
    ["matrix", { matrix: [{ caseId: "J-file-chrome", expected: { launch: true, offline: false } }] }],
    ["browser version", { environment: { ...context.environment, browserVersion: "157.0.0.0" } }],
  ])("marks old evidence stale after a %s change and the decision cannot pass", (_label, changed) => {
    const stale = evaluateBrowserEvidence(record(), { ...context, ...changed });
    expect(stale).toMatchObject({ checkId: "BROWSER_EVIDENCE_BINDING", result: "not-verified", evidence: { stale: true } });
    const decision = decideDelivery({
      mode: "standalone-full", checks: [stale], declaredEntryCount: 1, hdmvEntryCount: 1,
      hasMissingRequiredAsset: false, hasUnresolvedReachability: false, hasUnsupportedReachableCapability: false,
      requiredEvidenceComplete: true, coverageComplete: true,
    }, true);
    expect(decision).toMatchObject({ status: "partial", exitCode: 2 });
  });

  it("does not pass missing, malformed, failed, or matrix-orphaned evidence", () => {
    expect(evaluateBrowserEvidence(undefined, context, "J-file-chrome")).toMatchObject({ result: "not-verified" });
    const failed = createBrowserEvidence({
      caseId: "J-file-chrome", expected: { launch: true, offline: true }, actual: "launch failed", result: "fail", observedAt: "2026-11-02T00:00:00Z",
      environment: context.environment, artifacts: [{ path: "reports/evidence/J-file-chrome/console.txt", kind: "console", bytes: new Uint8Array([9]) }],
    }, context);
    expect(evaluateBrowserEvidence(failed, context).result).toBe("fail");
    expect(evaluateBrowserEvidence(record(), { ...context, matrix: [] })).toMatchObject({ result: "not-verified" });
    expect(() => createBrowserEvidence({
      caseId: "J-file-chrome", expected: true, actual: true, result: "pass", observedAt: "now", environment: context.environment,
      artifacts: [{ path: "reports/evidence/../image.png", kind: "screenshot", bytes: new Uint8Array([1]) }],
    }, context)).toThrow(/reports\/evidence/);
  });

  it("rejects edited expected results and environment metadata even when the binding blob is unchanged", () => {
    const editedExpected = record(); editedExpected.expected = { launch: false, offline: true };
    expect(evaluateBrowserEvidence(editedExpected, context)).toMatchObject({ result: "not-verified", evidence: { stale: true } });
    const editedEnvironment = record(); editedEnvironment.environment.browserVersion = "157.0.0.0";
    expect(evaluateBrowserEvidence(editedEnvironment, context)).toMatchObject({ result: "not-verified", evidence: { stale: true } });
  });

  it("retains every matrix case in the evidence gate and marks omitted rows not verified", () => {
    const changedMatrix = { ...context, matrix: [
      ...context.matrix,
      { caseId: "A-menu-static", expected: { image: "expected PNG", interaction: true } },
    ] };
    const checks = evaluateBrowserEvidenceMatrix([record()], changedMatrix);
    expect(checks).toHaveLength(2);
    expect(checks.map((check) => check.result)).toEqual(["not-verified", "not-verified"]);
    expect(checks.find((check) => check.entityId === "A-menu-static")?.message).toContain("No browser evidence");
  });

  it("uses stable profile serialization without requiring package fingerprints", () => {
    const left = createBrowserEvidenceBinding({ ...context, profile: { region: "A", outputProfile: "portable", audioLanguage: "eng" } });
    const right = createBrowserEvidenceBinding({ ...context, profile: { audioLanguage: "eng", region: "A", outputProfile: "portable" } });
    expect(left.profileFingerprint).toBe(right.profileFingerprint);
    expect(evaluateBrowserEvidence(record(), { ...context, payloadFingerprint: null }).result).toBe("pass");
  });
});
