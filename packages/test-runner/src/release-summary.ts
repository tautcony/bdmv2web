import { decideDelivery, type DeliveryDecisionInput, type DeliveryDecision } from "./decisions.js";
import type { CoverageReport, CoverageSummary } from "./coverage.js";
import type { CompatibilityReport, DependencyAuditReport } from "./report.js";
import { createCompatibilityReport } from "./report.js";
import type { AuditCheck, DeliveryStatus, OfflinePackageAudit } from "./types.js";

const REQUIRED_COVERAGE = ["entries", "instructions", "media", "tests"] as const;

export type ReleaseDecisionFacts = Omit<DeliveryDecisionInput, "mode" | "checks" | "requiredEvidenceComplete" | "coverageComplete">;

export interface ReleaseSummaryInput {
  audit: OfflinePackageAudit;
  mode: "menu-only" | "standalone-full";
  /** Where `mode` came from; `assumed` means neither manifest nor report declared it (D-13). */
  modeSource?: "manifest" | "report" | "assumed";
  dependencyAudit: DependencyAuditReport;
  coverage: CoverageReport | null;
  browserEvidence: readonly AuditCheck[];
  referenceEvidence: readonly AuditCheck[];
  decisionFacts: ReleaseDecisionFacts;
  strict?: boolean;
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
    mode: "menu-only" | "standalone-full";
    modeSource?: "manifest" | "report" | "assumed";
    payloadFingerprint: string | null;
    strict: boolean;
    exitCode: 0 | 1 | 2;
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

/** Aggregate fresh component facts; stored status fields are deliberately ignored. */
export function createReleaseSummary(input: ReleaseSummaryInput): ReleaseSummary {
  const coverage = input.coverage ?? {};
  const checks: AuditCheck[] = [];
  if (input.audit.checks.length === 0) {
    checks.push({ checkId: "PACKAGE_AUDIT_REQUIRED", result: "not-verified", message: "No independent output-package audit checks were supplied." });
  } else checks.push(...input.audit.checks);

  const dependencyChecks = input.dependencyAudit.checks.length
    ? [...input.dependencyAudit.checks]
    : [{ checkId: "DEPENDENCY_AUDIT_REQUIRED", result: "not-verified" as const, message: "No independent offline dependency checks were supplied." }];
  checks.push(...dependencyChecks);

  const coverageChecks = summarizeCoverageGates(coverage);
  checks.push(...coverageChecks);

  const browserChecks = input.browserEvidence.length
    ? [...input.browserEvidence]
    : [{ checkId: "BROWSER_EVIDENCE_REQUIRED", result: "not-verified" as const, message: "No V1 browser evidence was supplied." }];
  checks.push(...browserChecks);

  const referenceChecks = input.referenceEvidence.length
    ? [...input.referenceEvidence]
    : [{ checkId: "REFERENCE_EVIDENCE_REQUIRED", result: "not-verified" as const, message: "No independent reference comparison evidence was supplied." }];
  checks.push(...referenceChecks);

  const dependencyAudit: DependencyAuditReport = {
    schemaVersion: "1.0",
    payloadFingerprint: input.audit.payloadFingerprint,
    status: summarizeCheckResult(dependencyChecks),
    externalReferences: dependencyChecks.filter((check) => check.checkId.startsWith("OFFLINE_") && check.result !== "pass"),
    checks: dependencyChecks,
  };
  const browserEvidenceComplete = browserChecks.length > 0 && browserChecks.every((check) => check.result === "pass");
  const referenceEvidenceComplete = referenceChecks.length > 0 && referenceChecks.every((check) => check.result === "pass");
  const coverageComplete = coverageChecks.every((check) => check.result === "pass");
  const decisionInput: DeliveryDecisionInput = {
    mode: input.mode,
    checks,
    ...input.decisionFacts,
    requiredEvidenceComplete: browserEvidenceComplete && referenceEvidenceComplete,
    coverageComplete,
  };
  const decision: DeliveryDecision = decideDelivery(decisionInput, input.strict ?? false);
  const compatibility = createCompatibilityReport(input.audit, decision, input.mode, coverage);
  compatibility.checks = checks;
  compatibility.validationEvidence = checks.map(({ checkId, result, path, evidence }) => ({ checkId, result, ...(path === undefined ? {} : { path }), ...(evidence === undefined ? {} : { evidence }) }));
  const gaps = checks.filter((check): check is AuditCheck & { result: "fail" | "not-verified" } => check.result !== "pass").map(toGap);
  return {
    schemaVersion: "1.0",
    release: { status: decision.status, mode: input.mode, ...(input.modeSource === undefined ? {} : { modeSource: input.modeSource }), payloadFingerprint: input.audit.payloadFingerprint, strict: decision.strict, exitCode: decision.exitCode, reasons: decision.reasons, notVerified: decision.notVerified, gaps },
    compatibility,
    dependencyAudit,
    coverage,
    checks,
  };
}

function summarizeCoverageGates(report: CoverageReport): AuditCheck[] {
  return REQUIRED_COVERAGE.map((name) => {
    const summary = report[name];
    if (!summary) return { checkId: `COVERAGE_${name.toUpperCase()}`, result: "not-verified", message: `Coverage for ${name} was not supplied.` };
    if (isExplicitNotApplicable(summary)) return { checkId: `COVERAGE_${name.toUpperCase()}`, result: "pass", message: `${name} coverage is N/A with an explicit zero-item reason.`, evidence: { denominator: 0, reason: summary.reason } };
    if (isCompleteCoverage(summary)) return { checkId: `COVERAGE_${name.toUpperCase()}`, result: "pass", message: `${name} coverage accounts for every item with evidence.`, evidence: { denominator: summary.denominator, passed: summary.passed, failed: summary.failed, unknown: summary.unknown, percent: 100 } };
    return { checkId: `COVERAGE_${name.toUpperCase()}`, result: summary.failed > 0 ? "fail" : "not-verified", message: `${name} coverage is incomplete: ${coverageReason(summary)}.`, evidence: { denominator: summary.denominator, passed: summary.passed, failed: summary.failed, unknown: summary.unknown, percent: summary.percent ?? null } };
  });
}

function isExplicitNotApplicable(summary: CoverageSummary): boolean {
  return summary.status === "N/A" && summary.denominator === 0 && summary.passed === 0 && summary.failed === 0 && summary.unknown === 0 && summary.percent === null && typeof summary.reason === "string" && summary.reason.trim().length > 0;
}

function isCompleteCoverage(summary: CoverageSummary): boolean {
  return summary.status === "measured" && summary.complete === true && Number.isSafeInteger(summary.denominator) && (summary.denominator ?? 0) > 0 &&
    summary.passed === summary.denominator && summary.failed === 0 && summary.unknown === 0 && summary.percent === 100;
}

function coverageReason(summary: CoverageSummary): string {
  if (summary.reason?.trim()) return summary.reason;
  if (summary.denominator === null) return "the population denominator is unknown";
  if (summary.failed > 0) return `${summary.failed} item(s) failed`;
  if (summary.unknown > 0 || summary.complete !== true) return `${summary.unknown} item(s) remain unverified`;
  return "reported coverage fields are inconsistent";
}

function summarizeCheckResult(checks: readonly AuditCheck[]): DependencyAuditReport["status"] {
  if (checks.length === 0 || checks.some((check) => check.result === "not-verified")) return "not-verified";
  return checks.some((check) => check.result === "fail") ? "fail" : "pass";
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
