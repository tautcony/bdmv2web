import type { AuditCheck, DeliveryStatus, OfflinePackageAudit } from "./types.js";
import type { CoverageReport } from "./coverage.js";
import { compareVmTraces, validateCompareInput, type CompareInputSequence, type TraceComparison, type TraceEvent } from "./compare.js";

export interface CompatibilityReport {
  schemaVersion: "1.0";
  status: DeliveryStatus;
  profile?: string;
  checks: AuditCheck[];
  coverage: CoverageReport;
  reasons: string[];
  validationEvidence: Array<{ checkId: string; result: AuditCheck["result"]; path?: string; evidence?: Record<string, unknown> }>;
  externalDependencies?: unknown[];
  notVerified?: string[];
}

export interface DependencyAuditReport {
  schemaVersion: "1.0";
  status: "pass" | "fail" | "not-verified";
  externalReferences: AuditCheck[];
  checks: AuditCheck[];
}

export function createDependencyAuditReport(audit: OfflinePackageAudit): DependencyAuditReport {
  const relevant = audit.checks.filter((check) => check.checkId.startsWith("OFFLINE_") || check.checkId.startsWith("BUNDLE_") || check.checkId === "ACTIVE_EMBED");
  // `fail` outranks `not-verified`: a missing evidence item must not hide a failure.
  // An empty dependency surface of an audit that did run means "nothing to check",
  // not "unknown"; only an audit that produced no checks at all stays unverified.
  const status = relevant.some((check) => check.result === "fail")
    ? "fail"
    : relevant.some((check) => check.result === "not-verified") || audit.checks.length === 0
      ? "not-verified"
      : "pass";
  return { schemaVersion: "1.0", status, externalReferences: relevant.filter((check) => check.checkId.startsWith("OFFLINE_") && check.result !== "pass"), checks: relevant };
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

export interface ReferenceCompareReport extends CompareReport<TraceComparison> {
  input: CompareInputSequence;
  actualTrace: readonly TraceEvent[];
  referenceTrace: readonly TraceEvent[] | null;
}

export interface ReferenceCompareInput {
  input: unknown;
  actualTrace: readonly TraceEvent[];
  reference?: {
    trace: readonly TraceEvent[];
    tool: { name: string; version: string | null; invocation: string | null };
  };
}

/** Bind a validated input sequence to an actual trace and optional independent reference evidence. */
export function createReferenceCompareReport(args: ReferenceCompareInput): ReferenceCompareReport {
  if (!validateCompareInput(args.input)) throw new TypeError("Compare input is invalid.");
  const input = args.input;
  if (!args.reference) {
    return {
      schemaVersion: "1.0", fixtureId: input.fixtureId, sourceLabel: input.sourceLabel,
      referenceTool: null, result: "not-verified", comparison: null, input,
      actualTrace: args.actualTrace, referenceTrace: null,
      reason: "No independent reference trace was supplied; comparison is not verified.",
    };
  }
  const comparison = compareVmTraces(args.reference.trace, args.actualTrace);
  const versionRecorded = typeof args.reference.tool.version === "string" && args.reference.tool.version.trim().length > 0;
  return {
    schemaVersion: "1.0", fixtureId: input.fixtureId, sourceLabel: input.sourceLabel,
    referenceTool: args.reference.tool, result: !versionRecorded ? "not-verified" : comparison.equal ? "pass" : "fail", comparison,
    input, actualTrace: args.actualTrace, referenceTrace: args.reference.trace,
    ...(!versionRecorded ? { reason: "Reference tool version was not recorded; comparison is not verified." } : {}),
  };
}
