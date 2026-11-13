import { decideDelivery, type DeliveryDecisionInput, type DeliveryDecision } from "./decisions.js";
import type { CoverageReport } from "./coverage.js";
import type { CompatibilityReport, DependencyAuditReport } from "./report.js";
import type { AuditCheck, DeliveryStatus, OfflinePackageAudit } from "./types.js";

export type ReleaseDecisionFacts = Omit<DeliveryDecisionInput, "checks">;

export interface ReleaseSummaryInput {
  audit: OfflinePackageAudit;
  dependencyAudit: DependencyAuditReport;
  /** Recorded in the report; per-category counts are not part of the delivery verdict. */
  coverage: CoverageReport | null;
  decisionFacts: ReleaseDecisionFacts;
}

export interface ReleaseGap {
  checkId: string;
  result: "fail" | "not-verified";
  message: string;
  action: string;
  path?: string;
  entityId?: string;
}

export interface ReleaseSummary {
  schemaVersion: "1.0";
  release: {
    status: DeliveryStatus;
    exitCode: 0 | 1;
    reasons: string[];
    /** Evidence that was not collected or not verified; informational only. */
    notVerified: string[];
    gaps: ReleaseGap[];
  };
  compatibility: CompatibilityReport;
  dependencyAudit: DependencyAuditReport;
  coverage: CoverageReport;
  checks: AuditCheck[];
}

/** Aggregate fresh component facts. Status fields are computed from those facts. */
export function createReleaseSummary(input: ReleaseSummaryInput): ReleaseSummary {
  const coverage = input.coverage ?? {};
  const checks: AuditCheck[] = [];
  if (input.audit.checks.length === 0) {
    checks.push({ checkId: "PACKAGE_AUDIT_REQUIRED", result: "not-verified", message: "No independent output-package audit checks were supplied." });
  } else checks.push(...input.audit.checks);

  // A dependency surface of zero findings is a result, not a missing audit: only a
  // package audit that produced no checks at all leaves the dependency set unknown.
  const dependencyChecks = input.dependencyAudit.checks.length
    ? [...input.dependencyAudit.checks]
    : input.audit.checks.length === 0
      ? [{ checkId: "DEPENDENCY_AUDIT_REQUIRED", result: "not-verified" as const, message: "No independent package dependency checks were supplied." }]
      : [];
  checks.push(...dependencyChecks);

  const dependencyAudit: DependencyAuditReport = {
    schemaVersion: "1.0",
    status: summarizeCheckResult(dependencyChecks),
    externalReferences: dependencyChecks.filter((check) => check.checkId.startsWith("OFFLINE_") && check.result !== "pass"),
    checks: dependencyChecks,
  };
  const decisionInput: DeliveryDecisionInput = { checks, ...input.decisionFacts };
  const decision: DeliveryDecision = decideDelivery(decisionInput);
  const compatibility = {
    schemaVersion: "1.0" as const,
    status: decision.status,
    checks,
    coverage,
    reasons: decision.reasons,
    validationEvidence: checks.map(({ checkId, result, path, evidence }) => ({ checkId, result, ...(path === undefined ? {} : { path }), ...(evidence === undefined ? {} : { evidence }) })),
  };
  const gaps = checks.filter((check): check is AuditCheck & { result: "fail" | "not-verified" } => check.result !== "pass").map(toGap);
  return {
    schemaVersion: "1.0",
    release: { status: decision.status, exitCode: decision.exitCode, reasons: decision.reasons, notVerified: decision.notVerified, gaps },
    compatibility,
    dependencyAudit,
    coverage,
    checks,
  };
}

/** Priority is `fail` → `not-verified` → `pass`; an empty set has nothing to report. */
function summarizeCheckResult(checks: readonly AuditCheck[]): DependencyAuditReport["status"] {
  if (checks.some((check) => check.result === "fail")) return "fail";
  if (checks.some((check) => check.result === "not-verified")) return "not-verified";
  return "pass";
}

function toGap(check: AuditCheck & { result: "fail" | "not-verified" }): ReleaseGap {
  return {
    checkId: check.checkId,
    result: check.result,
    message: check.message,
    action: check.result === "fail" ? `Resolve ${check.checkId} and rerun release verification.` : `Supply or refresh the evidence for ${check.checkId}.`,
    ...(check.path === undefined ? {} : { path: check.path }),
    ...(check.entityId === undefined ? {} : { entityId: check.entityId }),
  };
}
