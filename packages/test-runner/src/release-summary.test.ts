import { describe, expect, it } from "vitest";
import { createReleaseSummary } from "./release-summary.js";
import { summarizeDeliveryCoverage } from "./coverage.js";
import type { AuditCheck, OfflinePackageAudit } from "./types.js";
import type { DependencyAuditReport } from "./report.js";

const pass = (checkId: string, evidence?: AuditCheck["evidence"]): AuditCheck => ({ checkId, result: "pass", message: `${checkId} passed.`, ...(evidence ? { evidence } : {}) });

function audit(checks: AuditCheck[] = [pass("PACKAGE_VALID")]): OfflinePackageAudit {
  return { schemaVersion: "1.0", packageRoot: "/output", manifestPath: "/output/manifest.json", checks, discoveredPayloadFiles: [] };
}

function dependencyAudit(checks: AuditCheck[] = [pass("OFFLINE_DEPENDENCIES_VALID")], status: DependencyAuditReport["status"] = "pass"): DependencyAuditReport {
  return { schemaVersion: "1.0", status, externalReferences: [], checks };
}

const completeCoverage = summarizeDeliveryCoverage({
  entries: { total: 1, passed: 1, failed: 0, unknown: 0, evidenceComplete: true },
  instructions: { total: 1, passed: 1, failed: 0, unknown: 0, evidenceComplete: true },
  media: { total: 1, passed: 1, failed: 0, unknown: 0, evidenceComplete: true },
  tests: { total: 1, passed: 1, failed: 0, unknown: 0, evidenceComplete: true },
});

const completeDecisionFacts = {
  declaredEntryCount: 1,
  hdmvEntryCount: 1,
  hasUnresolvedReachability: false,
  hasUnsupportedReachableCapability: false,
  hasMissingRequiredAsset: false,
};

describe("release summary aggregation", () => {
  it("keeps status complete while listing missing browser, reference, dependency, and coverage evidence as gaps", () => {
    const summary = createReleaseSummary({
      audit: audit(), mode: "standalone-full", dependencyAudit: dependencyAudit([], "pass"), coverage: null,
      browserEvidence: [], referenceEvidence: [], decisionFacts: completeDecisionFacts,
    });

    // Missing evidence is reported, not treated as a failure (D-2R).
    expect(summary.release.status).toBe("complete");
    expect(summary.release.notVerified).toEqual(expect.arrayContaining(["DEPENDENCY_AUDIT_REQUIRED", "BROWSER_EVIDENCE_REQUIRED", "REFERENCE_EVIDENCE_REQUIRED"]));
    expect(summary.release.gaps.map((gap) => gap.checkId)).toEqual(expect.arrayContaining([
      "DEPENDENCY_AUDIT_REQUIRED", "COVERAGE_ENTRIES", "COVERAGE_INSTRUCTIONS", "COVERAGE_MEDIA", "COVERAGE_TESTS",
      "BROWSER_EVIDENCE_REQUIRED", "REFERENCE_EVIDENCE_REQUIRED",
    ]));
    expect(summary.release.gaps.every((gap) => gap.result === "not-verified" && gap.action.length > 0)).toBe(true);
    expect(summary.compatibility.status).toBe("complete");
  });

  it("keeps the recorded menu-only mode separate from delivery status", () => {
    const summary = createReleaseSummary({
      audit: audit(), mode: "menu-only", dependencyAudit: dependencyAudit(), coverage: completeCoverage,
      browserEvidence: [pass("BROWSER_EVIDENCE")], referenceEvidence: [pass("REFERENCE_COMPARISON")],
      decisionFacts: completeDecisionFacts,
    });

    expect(summary.release.status).toBe("complete");

    const gapped = createReleaseSummary({
      audit: audit(), mode: "menu-only", dependencyAudit: dependencyAudit(), coverage: completeCoverage,
      browserEvidence: [pass("BROWSER_EVIDENCE")], referenceEvidence: [pass("REFERENCE_COMPARISON")],
      decisionFacts: { ...completeDecisionFacts, hasUnresolvedReachability: true },
    });
    expect(gapped.release.status).toBe("partial");
  });

  it("allows complete only from current passing tool facts and ignores persisted component statuses", () => {
    const summary = createReleaseSummary({
      audit: audit(), mode: "standalone-full", dependencyAudit: dependencyAudit([pass("OFFLINE_DEPENDENCIES_VALID")], "fail"),
      coverage: completeCoverage, browserEvidence: [pass("BROWSER_EVIDENCE")],
      referenceEvidence: [pass("REFERENCE_COMPARISON")], decisionFacts: completeDecisionFacts,
    });

    expect(summary.release.status).toBe("complete");
    expect(summary.dependencyAudit.status).toBe("pass");
    expect(summary.release.gaps).toEqual([]);
  });

});
