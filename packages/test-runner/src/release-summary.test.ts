import { describe, expect, it } from "vitest";
import { createReleaseSummary } from "./release-summary.js";
import { decideDelivery } from "./decisions.js";
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
  it("keeps status complete while listing an audit that never ran as a gap", () => {
    const summary = createReleaseSummary({
      audit: audit([]), dependencyAudit: dependencyAudit([], "pass"), coverage: null,
      decisionFacts: completeDecisionFacts,
    });

    // Missing evidence is reported, not treated as a failure (D-2R).
    expect(summary.release.status).toBe("complete");
    expect(summary.release.notVerified).toEqual(expect.arrayContaining(["DEPENDENCY_AUDIT_REQUIRED"]));
    expect(summary.release.gaps.map((gap) => gap.checkId)).toEqual(["PACKAGE_AUDIT_REQUIRED", "DEPENDENCY_AUDIT_REQUIRED"]);
    expect(summary.release.gaps.every((gap) => gap.result === "not-verified" && gap.action.length > 0)).toBe(true);
    expect(summary.compatibility.status).toBe("complete");
  });

  it("treats an empty dependency surface as nothing to report", () => {
    const summary = createReleaseSummary({
      audit: audit(), dependencyAudit: dependencyAudit([], "pass"), coverage: null,
      decisionFacts: completeDecisionFacts,
    });

    // The package audit ran and found no runtime references: that is a pass with
    // zero findings, not an unverified audit.
    expect(summary.release.status).toBe("complete");
    expect(summary.release.gaps).toEqual([]);
    expect(summary.dependencyAudit).toMatchObject({ status: "pass", checks: [], externalReferences: [] });
  });

  it("never turns absent coverage counts into delivery gaps", () => {
    const summary = createReleaseSummary({
      audit: audit(), dependencyAudit: dependencyAudit(), coverage: null,
      decisionFacts: completeDecisionFacts,
    });

    expect(summary.release.gaps).toEqual([]);
    expect(summary.release.notVerified).not.toEqual(expect.arrayContaining(["COVERAGE_INCOMPLETE", "COVERAGE_ENTRIES", "COVERAGE_INSTRUCTIONS", "COVERAGE_MEDIA", "COVERAGE_TESTS"]));
  });

  it("uses current evidence to determine delivery status", () => {
    const summary = createReleaseSummary({
      audit: audit(), dependencyAudit: dependencyAudit(), coverage: completeCoverage,
      decisionFacts: completeDecisionFacts,
    });

    expect(summary.release.status).toBe("complete");

    const gapped = createReleaseSummary({
      audit: audit(), dependencyAudit: dependencyAudit(), coverage: completeCoverage,
      decisionFacts: { ...completeDecisionFacts, hasUnresolvedReachability: true },
    });
    expect(gapped.release.status).toBe("partial");
  });

  it("allows complete only from current passing tool facts and ignores persisted component statuses", () => {
    const summary = createReleaseSummary({
      audit: audit(), dependencyAudit: dependencyAudit([pass("OFFLINE_DEPENDENCIES_VALID")], "fail"),
      coverage: completeCoverage, decisionFacts: completeDecisionFacts,
    });

    expect(summary.release.status).toBe("complete");
    expect(summary.dependencyAudit.status).toBe("pass");
    expect(summary.release.gaps).toEqual([]);
  });

});

const failing = (checkId: string): AuditCheck => ({ checkId, result: "fail", message: `${checkId} failed.` });
const unverified = (checkId: string): AuditCheck => ({ checkId, result: "not-verified", message: `${checkId} was not verified.` });

function summarize(checks: AuditCheck[]) {
  return createReleaseSummary({
    audit: audit(), dependencyAudit: dependencyAudit(checks, "pass"), coverage: completeCoverage,
    decisionFacts: completeDecisionFacts,
  });
}

describe("check result aggregation priority", () => {
  it("reports fail when fail and not-verified coexist, in either order", () => {
    for (const checks of [[failing("OFFLINE_ROOT_ESCAPE"), unverified("OFFLINE_EXTERNAL_TARGET")], [unverified("OFFLINE_EXTERNAL_TARGET"), failing("OFFLINE_ROOT_ESCAPE")]]) {
      const summary = summarize(checks);
      expect(summary.dependencyAudit.status).toBe("fail");
      expect(summary.release.status).toBe("failed");
      expect(summary.release.exitCode).toBe(1);
      expect(summary.release.notVerified).toContain("OFFLINE_EXTERNAL_TARGET");
      expect(summary.release.gaps.map((gap) => gap.checkId)).toEqual(expect.arrayContaining(["OFFLINE_ROOT_ESCAPE", "OFFLINE_EXTERNAL_TARGET"]));
    }
  });

  it("keeps fail ahead of not-verified for duplicate and mixed check lists", () => {
    expect(summarize([unverified("OFFLINE_A"), unverified("OFFLINE_B"), failing("OFFLINE_C")]).dependencyAudit.status).toBe("fail");
    expect(summarize([failing("OFFLINE_A"), failing("OFFLINE_B")]).dependencyAudit.status).toBe("fail");
    expect(summarize([unverified("OFFLINE_A"), unverified("OFFLINE_B")]).dependencyAudit.status).toBe("not-verified");
  });

  it("reports nothing for a dependency surface with zero findings", () => {
    const summary = summarize([]);
    expect(summary.dependencyAudit.status).toBe("pass");
    expect(summary.release.status).toBe("complete");
    expect(summary.release.gaps).toEqual([]);
    expect(summary.release.notVerified).not.toContain("DEPENDENCY_AUDIT_REQUIRED");
  });

  it("flips the report back to failed as soon as the failing check is present", () => {
    expect(summarize([pass("OFFLINE_OK")]).release.status).toBe("complete");
    expect(summarize([pass("OFFLINE_OK"), failing("OFFLINE_ROOT_ESCAPE")]).release.status).toBe("failed");
    // Same check ids in both runs: only the result of one check differs.
    expect(summarize([pass("OFFLINE_ROOT_ESCAPE"), unverified("OFFLINE_EXTERNAL_TARGET")]).release.status).toBe("complete");
    expect(summarize([failing("OFFLINE_ROOT_ESCAPE"), unverified("OFFLINE_EXTERNAL_TARGET")]).release.status).toBe("failed");
  });

});

describe("delivery decision truth table", () => {
  const facts = { declaredEntryCount: 1, hdmvEntryCount: 1, hasUnresolvedReachability: false, hasUnsupportedReachableCapability: false, hasMissingRequiredAsset: false };
  const decide = (overrides: Partial<typeof facts> & { checks?: AuditCheck[]; diagnostics?: Parameters<typeof decideDelivery>[0]["diagnostics"] } = {}) => {
    const { checks = [pass("PACKAGE_VALID")], diagnostics, ...rest } = overrides;
    return decideDelivery({ checks, ...(diagnostics === undefined ? {} : { diagnostics }), ...facts, ...rest });
  };

  it("returns complete with exit 0 when every check passes", () => {
    const decision = decide();
    expect(decision.status).toBe("complete");
    expect(decision.exitCode).toBe(0);
    expect(decision.notVerified).toEqual([]);
  });

  it("returns complete while listing unverified evidence that is not a failure", () => {
    const decision = decide({ checks: [pass("PACKAGE_VALID"), unverified("OFFLINE_EXTERNAL_TARGET")] });
    expect(decision.status).toBe("complete");
    expect(decision.exitCode).toBe(0);
    expect(decision.notVerified).toEqual(expect.arrayContaining(["OFFLINE_EXTERNAL_TARGET"]));
  });

  it("returns failed when a failing check coexists with unverified evidence", () => {
    const decision = decide({ checks: [unverified("OFFLINE_EXTERNAL_TARGET"), failing("OFFLINE_ROOT_ESCAPE")] });
    expect(decision.status).toBe("failed");
    expect(decision.exitCode).toBe(1);
    expect(decision.blockingChecks.map((check) => check.checkId)).toEqual(["OFFLINE_ROOT_ESCAPE"]);
  });

  it("keeps a reachable unsupported capability partial", () => {
    expect(decide({ hasUnsupportedReachableCapability: true })).toMatchObject({ status: "partial", exitCode: 0 });
  });

  it("keeps acknowledged errors partial", () => {
    const diagnostics = [{ severity: "error", code: "MEDIA_TARGET_UNAVAILABLE", acknowledged: true, acknowledgement: { by: "reviewer", reason: "accepted" } }];
    expect(decide({ diagnostics })).toMatchObject({ status: "partial", exitCode: 0 });
  });

  it("fails pure BD-J packages, fatal diagnostics and missing required assets", () => {
    expect(decide({ hdmvEntryCount: 0 }).status).toBe("failed");
    expect(decide({ diagnostics: [{ severity: "fatal", code: "PACKAGE_CORRUPT" }] }).status).toBe("failed");
    expect(decide({ hasMissingRequiredAsset: true }).status).toBe("failed");
    expect(decide({ hdmvEntryCount: 0 }).exitCode).toBe(1);
  });
});
