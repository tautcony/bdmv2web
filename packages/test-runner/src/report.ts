import type { AuditCheck, DeliveryStatus, OfflinePackageAudit } from "./types.js";
import type { CoverageReport } from "./coverage.js";
import type { DeliveryDecision } from "./decisions.js";

export interface CompatibilityReport {
  schemaVersion: "1.0";
  status: DeliveryStatus;
  mode: "menu-only" | "standalone-full";
  payloadFingerprint: string | null;
  checks: AuditCheck[];
  coverage: CoverageReport;
  reasons: string[];
  validationEvidence: Array<{ checkId: string; result: AuditCheck["result"]; path?: string; evidence?: Record<string, unknown> }>;
}

export interface DependencyAuditReport {
  schemaVersion: "1.0";
  payloadFingerprint: string | null;
  status: "pass" | "fail" | "not-verified";
  externalReferences: AuditCheck[];
  checks: AuditCheck[];
}

export function createCompatibilityReport(audit: OfflinePackageAudit, decision: DeliveryDecision, mode: "menu-only" | "standalone-full", coverage: CoverageReport): CompatibilityReport {
  return {
    schemaVersion: "1.0",
    status: decision.status,
    mode,
    payloadFingerprint: audit.payloadFingerprint,
    checks: audit.checks,
    coverage,
    reasons: decision.reasons,
    validationEvidence: audit.checks.map(({ checkId, result, path, evidence }) => ({ checkId, result, ...(path === undefined ? {} : { path }), ...(evidence === undefined ? {} : { evidence }) })),
  };
}

export function createDependencyAuditReport(audit: OfflinePackageAudit): DependencyAuditReport {
  const relevant = audit.checks.filter((check) => check.checkId.startsWith("OFFLINE_") || check.checkId.startsWith("BUNDLE_") || check.checkId === "ACTIVE_EMBED");
  const status = relevant.some((check) => check.result === "fail") ? "fail" : relevant.some((check) => check.result === "not-verified") ? "not-verified" : "pass";
  return { schemaVersion: "1.0", payloadFingerprint: audit.payloadFingerprint, status, externalReferences: relevant.filter((check) => check.checkId.startsWith("OFFLINE_") && check.result !== "pass"), checks: relevant };
}

export interface CompareReport<T = unknown> {
  schemaVersion: "1.0";
  fixtureId: string;
  sourceLabel: string;
  referenceTool: { name: string; version: string | null; invocation: string | null } | null;
  result: "pass" | "fail" | "not-verified";
  comparison: T | null;
  reason?: string;
}

export function createCompareReport<T>(args: Omit<CompareReport<T>, "schemaVersion">): CompareReport<T> {
  return { schemaVersion: "1.0", ...args };
}
