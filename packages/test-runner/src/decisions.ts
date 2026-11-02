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
  mode: "menu-only" | "standalone-full";
  checks: readonly AuditCheck[];
  diagnostics?: readonly DeliveryDiagnostic[];
  limitations?: readonly string[];
  declaredEntryCount?: number;
  hdmvEntryCount?: number;
  hasUnresolvedReachability?: boolean;
  hasUnsupportedReachableCapability?: boolean;
  hasMissingRequiredAsset?: boolean;
  requiredEvidenceComplete?: boolean;
  coverageComplete?: boolean;
}

export interface DeliveryDecision {
  status: DeliveryStatus;
  strict: boolean;
  exitCode: 0 | 1 | 2;
  reasons: string[];
  blockingChecks: AuditCheck[];
}

export function acknowledgeDiagnostic<T extends DeliveryDiagnostic>(diagnostic: T, by: string, reason: string): T & { acknowledged: true; acknowledgement: { by: string; reason: string } } {
  return { ...diagnostic, acknowledged: true, acknowledgement: { by, reason } };
}

export function decideDelivery(input: DeliveryDecisionInput, strict: boolean): DeliveryDecision {
  const reasons: string[] = [];
  const blockingChecks = input.checks.filter((check) => check.result === "fail");
  const failedDiagnostic = input.diagnostics?.some((d) => d.severity.toLowerCase() === "fatal");
  const errorDiagnostic = input.diagnostics?.some((d) => ["error", "fatal"].includes(d.severity.toLowerCase()));
  const onlyBdj = input.declaredEntryCount !== undefined && input.hdmvEntryCount === 0;
  const hardFailure = blockingChecks.length > 0 || failedDiagnostic || onlyBdj || input.hasMissingRequiredAsset === true;
  if (blockingChecks.length) reasons.push("One or more package or offline checks failed.");
  if (failedDiagnostic) reasons.push("A fatal diagnostic is present.");
  if (onlyBdj) reasons.push("No valid HDMV entry is available for this release profile.");
  if (input.hasMissingRequiredAsset) reasons.push("A required package asset is missing.");

  const unverifiedChecks = input.checks.filter((check) => check.result === "not-verified");
  const partialConditions: boolean[] = [
    input.mode === "menu-only",
    input.checks.length === 0,
    input.declaredEntryCount === undefined || input.hdmvEntryCount === undefined,
    input.hasMissingRequiredAsset === undefined,
    input.hasUnresolvedReachability !== false,
    input.hasUnsupportedReachableCapability !== false,
    input.diagnostics?.some((d) => ["error", "fatal"].includes(d.severity.toLowerCase())) ?? false,
    input.diagnostics?.some((d) => !["debug", "info", "warning", "error", "fatal"].includes(d.severity.toLowerCase())) ?? false,
    input.hasUnresolvedReachability === true,
    input.hasUnsupportedReachableCapability === true,
    input.requiredEvidenceComplete !== true,
    input.coverageComplete !== true,
    unverifiedChecks.length > 0,
  ];
  if (input.mode === "menu-only") reasons.push("menu-only output is always partial.");
  if (input.checks.length === 0) reasons.push("No audit checks were supplied.");
  if (input.declaredEntryCount === undefined || input.hdmvEntryCount === undefined) reasons.push("Entry counts are missing.");
  if (input.hasMissingRequiredAsset === undefined || input.hasUnresolvedReachability === undefined || input.hasUnsupportedReachableCapability === undefined) reasons.push("Capability and asset facts are incomplete.");
  if (errorDiagnostic && !failedDiagnostic) reasons.push("An error diagnostic blocks complete status even when acknowledged.");
  if (input.hasUnresolvedReachability) reasons.push("Reachability contains unresolved or unknown paths.");
  if (input.hasUnsupportedReachableCapability) reasons.push("A reachable capability is unsupported.");
  if (input.requiredEvidenceComplete === false || unverifiedChecks.length > 0) reasons.push("Required evidence is missing or not verified.");
  if (input.coverageComplete !== true) reasons.push("Coverage is incomplete or contains unknown items.");
  if (input.limitations?.length) reasons.push(...input.limitations.map((item) => `Limitation: ${item}`));
  const status: DeliveryStatus = hardFailure ? "failed" : partialConditions.some(Boolean) || input.limitations?.length ? "partial" : "complete";
  const exitCode: 0 | 1 | 2 = status === "failed" ? 1 : status === "partial" && strict ? 2 : 0;
  return { status, strict, exitCode, reasons: [...new Set(reasons)], blockingChecks };
}
