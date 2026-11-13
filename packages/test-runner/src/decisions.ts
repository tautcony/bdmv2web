import type { AuditCheck, DeliveryStatus } from "./types.js";

export interface DeliveryDiagnostic {
  severity: string;
  code?: string;
  acknowledged?: boolean;
  blocksComplete?: boolean;
  message?: string;
  sourcePath?: string | null;
  entityId?: string | null;
  acknowledgement?: { by: string; reason: string };
}

export interface DeliveryDecisionInput {
  checks: readonly AuditCheck[];
  diagnostics?: readonly DeliveryDiagnostic[];
  limitations?: readonly string[];
  declaredEntryCount?: number;
  hdmvEntryCount?: number;
  hasUnresolvedReachability?: boolean;
  hasUnsupportedReachableCapability?: boolean;
  hasMissingRequiredAsset?: boolean;
}

export interface DeliveryDecision {
  status: DeliveryStatus;
  exitCode: 0 | 1;
  reasons: string[];
  /**
   * Evidence that was not collected or not verified. Reported for information
   * only: `complete` means "no known failure", not "fully verified" (D-2R).
   */
  notVerified: string[];
  blockingChecks: AuditCheck[];
}

/**
 * Result of one command stage (inspect/extract). Deliberately not
 * `DeliveryStatus`: a stage can only say whether its own goal was reached, and
 * `status: "complete"` from a stage must never be read as a complete delivery.
 */
const STAGE_STATUS_BRAND: unique symbol = Symbol("StageStatus");
export type StageStatus = ("complete" | "partial" | "failed") & { readonly [STAGE_STATUS_BRAND]: true };

export interface StageOutcomeInput {
  /** Recorded for the caller; the verdict only depends on the diagnostics. */
  stage: "inspect" | "extract";
  diagnostics?: readonly DeliveryDiagnostic[];
}

export interface StageOutcome {
  status: StageStatus;
  exitCode: 0 | 1;
  blockingDiagnostics: DeliveryDiagnostic[];
}

function stageStatus(status: "complete" | "partial" | "failed"): StageStatus {
  return status as StageStatus;
}

/** Single narrowing point for the branded delivery status. */
function deliveryStatus(status: "complete" | "partial" | "failed"): DeliveryStatus {
  return status as DeliveryStatus;
}

export interface DiagnosticClassification {
  hasFatal: boolean;
  hasBlockingError: boolean;
  blocking: DeliveryDiagnostic[];
}

/** Single source of truth for "does this diagnostic block a complete outcome". */
export function classifyDiagnostics(diagnostics: readonly DeliveryDiagnostic[] | undefined): DiagnosticClassification {
  const blocking = (diagnostics ?? []).filter((diagnostic) => ["error", "fatal"].includes(diagnostic.severity.toLowerCase()));
  return {
    hasFatal: blocking.some((diagnostic) => diagnostic.severity.toLowerCase() === "fatal"),
    hasBlockingError: blocking.length > 0,
    blocking,
  };
}

export function acknowledgeDiagnostic<T extends DeliveryDiagnostic>(diagnostic: T, by: string, reason: string): T & { acknowledged: true; acknowledgement: { by: string; reason: string } } {
  return { ...diagnostic, acknowledged: true, acknowledgement: { by, reason } };
}

export function decideDelivery(input: DeliveryDecisionInput): DeliveryDecision {
  const reasons: string[] = [];
  const notVerified: string[] = [];
  const blockingChecks = input.checks.filter((check) => check.result === "fail");
  const diagnosticFacts = classifyDiagnostics(input.diagnostics);
  const failedDiagnostic = diagnosticFacts.hasFatal;
  const errorDiagnostic = diagnosticFacts.hasBlockingError;
  const onlyBdj = input.declaredEntryCount !== undefined && input.hdmvEntryCount === 0;
  const hardFailure = blockingChecks.length > 0 || failedDiagnostic || onlyBdj || input.hasMissingRequiredAsset === true;
  if (blockingChecks.length) reasons.push("One or more package audit checks failed.");
  if (failedDiagnostic) reasons.push("A fatal diagnostic is present.");
  if (onlyBdj) reasons.push("No valid HDMV entry is available for this release profile.");
  if (input.hasMissingRequiredAsset) reasons.push("A required package asset is missing.");

  // Checks that never ran and counts that were never supplied are collected in
  // `notVerified`; the status keeps its value (D-2R).
  const unverifiedChecks = input.checks.filter((check) => check.result === "not-verified");
  notVerified.push(...unverifiedChecks.map((check) => check.checkId));
  if (input.checks.length === 0) notVerified.push("NO_AUDIT_CHECKS");
  if (input.declaredEntryCount === undefined || input.hdmvEntryCount === undefined) notVerified.push("ENTRY_COUNTS_MISSING");
  if (input.hasMissingRequiredAsset === undefined || input.hasUnresolvedReachability === undefined || input.hasUnsupportedReachableCapability === undefined) notVerified.push("CAPABILITY_FACTS_INCOMPLETE");

  // Only failure evidence blocks `complete`: unresolved reachability, unsupported
  // reachable capabilities, blocking errors and unrecognised severities.
  const unknownSeverity = input.diagnostics?.some((diagnostic) => !["debug", "info", "warning", "error", "fatal"].includes(diagnostic.severity.toLowerCase())) ?? false;
  const partialConditions: boolean[] = [
    input.hasUnresolvedReachability === true,
    input.hasUnsupportedReachableCapability === true,
    errorDiagnostic && !failedDiagnostic,
    unknownSeverity,
  ];
  if (input.hasUnresolvedReachability) reasons.push("Reachability contains unresolved or unknown paths.");
  if (input.hasUnsupportedReachableCapability) reasons.push("A reachable capability is unsupported.");
  if (errorDiagnostic && !failedDiagnostic) reasons.push("Blocking error diagnostics prevent complete status.");
  if (unknownSeverity) reasons.push("A diagnostic uses an unrecognised severity.");
  // Limitations are explanatory only; they are listed but never decide the status.
  if (input.limitations?.length) reasons.push(...input.limitations.map((item) => `Limitation: ${item}`));
  const status: DeliveryStatus = deliveryStatus(hardFailure ? "failed" : partialConditions.some(Boolean) ? "partial" : "complete");
  const exitCode: 0 | 1 = status === "failed" ? 1 : 0;
  return { status, exitCode, reasons: [...new Set(reasons)], notVerified: [...new Set(notVerified)], blockingChecks };
}

/**
 * Decide whether one command stage reached its own goal. `complete` here means
 * "this stage produced what it promised", never "the delivery is complete".
 */
export function decideStageOutcome(input: StageOutcomeInput): StageOutcome {
  const facts = classifyDiagnostics(input.diagnostics);
  if (facts.hasFatal) return { status: stageStatus("failed"), exitCode: 1, blockingDiagnostics: facts.blocking };
  if (facts.hasBlockingError) return { status: stageStatus("partial"), exitCode: 0, blockingDiagnostics: facts.blocking };
  return { status: stageStatus("complete"), exitCode: 0, blockingDiagnostics: [] };
}
