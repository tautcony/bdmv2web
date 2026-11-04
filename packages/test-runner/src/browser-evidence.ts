import { createHash } from "node:crypto";
import type { AuditCheck, CheckResult, ManifestFile } from "./types.js";

export interface BrowserMatrixCase {
  caseId: string;
  expected: unknown;
}

export interface BrowserEnvironment {
  os: string;
  osBuild: string;
  browser: string;
  browserVersion: string;
}

export interface BrowserEvidenceContext {
  payloadFingerprint: string | null;
  mode: "menu-only" | "standalone-full";
  profile: unknown;
  /** Rows from this tool's output manifest only; never pass source-disc files. */
  generatedFiles: readonly (ManifestFile & { byteLength: string; sha256?: string })[];
  matrix: readonly BrowserMatrixCase[];
  environment: BrowserEnvironment;
}

export interface BrowserEvidenceArtifact {
  path: string;
  kind: string;
  byteLength: string;
  sha256: string;
}

export interface BrowserEvidence {
  schemaVersion: "1.0";
  caseId: string;
  expected: unknown;
  actual: unknown;
  result: CheckResult;
  observedAt: string;
  environment: BrowserEnvironment;
  binding: {
    payloadFingerprint: string | null;
    generatedMediaFingerprint: string;
    profileFingerprint: string;
    mode: "menu-only" | "standalone-full";
    matrixFingerprint: string;
    environmentFingerprint: string;
  };
  artifacts: BrowserEvidenceArtifact[];
}

export interface BrowserEvidenceObservation {
  caseId: string;
  expected: unknown;
  actual: unknown;
  result: CheckResult;
  observedAt: string;
  environment: BrowserEnvironment;
  artifacts: Array<{ path: string; kind: string; bytes: Uint8Array }>;
}

const EVIDENCE_PATH = /^reports\/evidence\/(?:[A-Za-z0-9._ -]|%[0-9A-Fa-f]{2}|[^/])+\/(?:[A-Za-z0-9._ -]|%[0-9A-Fa-f]{2}|[^/])+$/;

/** Create reproducible binding digests using JSON data only. */
export function createBrowserEvidenceBinding(context: BrowserEvidenceContext): BrowserEvidence["binding"] {
  if (context.mode !== "menu-only" && context.mode !== "standalone-full") throw new TypeError("A supported package mode is required to bind browser evidence");
  const matrix = normalizedMatrix(context.matrix);
  const environment = normalizedEnvironment(context.environment);
  const mediaRows = context.generatedFiles
    .filter((file) => ["media", "audio"].includes(file.kind.toLowerCase()))
    .map(({ path, kind, byteLength }) => ({ path, kind: kind.toLowerCase(), byteLength }))
    .sort((a, b) => a.path.localeCompare(b.path, "en"));
  if (mediaRows.some((file) => !isSafeRelativePath(file.path))) {
    throw new TypeError("Generated media manifest rows need safe paths");
  }
  return {
    payloadFingerprint: context.payloadFingerprint,
    generatedMediaFingerprint: digest(mediaRows),
    profileFingerprint: digest(context.profile),
    mode: context.mode,
    matrixFingerprint: digest(matrix),
    environmentFingerprint: digest(environment),
  };
}

/** Record hashes only for generated evidence artifacts, never for source-disc files. */
export function createBrowserEvidence(observation: BrowserEvidenceObservation, context: BrowserEvidenceContext): BrowserEvidence {
  const matrix = normalizedMatrix(context.matrix);
  if (!matrix.some((entry) => entry.caseId === observation.caseId)) throw new TypeError(`Browser case '${observation.caseId}' is not in the supplied matrix`);
  if (!observation.observedAt.trim()) throw new TypeError("Browser evidence observedAt must be non-empty");
  if (!["pass", "fail", "not-verified"].includes(observation.result)) throw new TypeError("Browser evidence result is invalid");
  const environment = normalizedEnvironment(observation.environment);
  if (digest(environment) !== digest(normalizedEnvironment(context.environment))) throw new TypeError("Observation environment does not match the evidence binding context");
  const artifacts = observation.artifacts.map(({ path, kind, bytes }) => {
    if (!isEvidencePath(path)) throw new TypeError(`Evidence artifact path must be under reports/evidence/: ${path}`);
    if (!kind.trim()) throw new TypeError("Evidence artifact kind must be non-empty");
    return { path, kind, byteLength: String(bytes.byteLength), sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  return {
    schemaVersion: "1.0", caseId: observation.caseId, expected: observation.expected, actual: observation.actual,
    result: observation.result, observedAt: observation.observedAt, environment,
    binding: createBrowserEvidenceBinding(context), artifacts,
  };
}

/** Return a check that can be included in decideDelivery(...). Stale evidence is not verified. */
export function evaluateBrowserEvidence(evidence: BrowserEvidence | null | undefined, context: BrowserEvidenceContext, caseId?: string): AuditCheck {
  const id = caseId ?? evidence?.caseId ?? "unknown";
  if (!evidence) return { checkId: "BROWSER_EVIDENCE_BINDING", result: "not-verified", message: `No browser evidence is recorded for case ${id}.`, entityId: id };
  let current: BrowserEvidence["binding"];
  try { current = createBrowserEvidenceBinding(context); }
  catch (error) {
    return { checkId: "BROWSER_EVIDENCE_BINDING", result: "not-verified", message: `Current package binding is incomplete: ${errorMessage(error)}`, entityId: id };
  }
  if (evidence.schemaVersion !== "1.0" || evidence.caseId !== id) {
    return { checkId: "BROWSER_EVIDENCE_BINDING", result: "not-verified", message: `Browser evidence does not identify current case ${id}.`, entityId: id };
  }
  const matrixCase = normalizedMatrix(context.matrix).find((entry) => entry.caseId === id);
  if (!matrixCase) return { checkId: "BROWSER_EVIDENCE_BINDING", result: "not-verified", message: `Case ${id} is not present in the current browser matrix.`, entityId: id };
  let expectedMismatch = false;
  let environmentMismatch = false;
  try {
    expectedMismatch = digest(evidence.expected) !== digest(matrixCase.expected);
    environmentMismatch = digest(normalizedEnvironment(evidence.environment)) !== current.environmentFingerprint;
  } catch { expectedMismatch = true; environmentMismatch = true; }
  const mismatches: string[] = (["profileFingerprint", "mode", "matrixFingerprint", "environmentFingerprint"] as const).filter((key) => evidence.binding?.[key] !== current[key]);
  if (expectedMismatch) mismatches.push("matrixCase.expected");
  if (environmentMismatch) mismatches.push("recordedEnvironment");
  if (mismatches.length) {
    return { checkId: "BROWSER_EVIDENCE_BINDING", result: "not-verified", message: `Browser evidence is stale because its binding changed: ${mismatches.join(", ")}.`, entityId: id, evidence: { stale: true, mismatches } };
  }
  if (typeof evidence.observedAt !== "string" || !evidence.observedAt.trim()) return { checkId: "BROWSER_EVIDENCE_BINDING", result: "not-verified", message: `Browser evidence for case ${id} has no observation timestamp.`, entityId: id };
  const artifactsValid = Array.isArray(evidence.artifacts) && evidence.artifacts.length > 0 && evidence.artifacts.every((artifact) =>
    isEvidencePath(artifact.path) && artifact.kind.trim().length > 0);
  if (!artifactsValid) return { checkId: "BROWSER_EVIDENCE_BINDING", result: "not-verified", message: `Browser evidence for case ${id} has no valid generated artifact record.`, entityId: id };
  if (evidence.result === "fail") return { checkId: "BROWSER_EVIDENCE_BINDING", result: "fail", message: `Browser case ${id} failed.`, entityId: id };
  if (evidence.result !== "pass") return { checkId: "BROWSER_EVIDENCE_BINDING", result: "not-verified", message: `Browser case ${id} has not been verified.`, entityId: id };
  return { checkId: "BROWSER_EVIDENCE_BINDING", result: "pass", message: `Browser evidence for case ${id} is bound to the current profile, mode, matrix, and environment.`, entityId: id, evidence: { payloadFingerprint: current.payloadFingerprint, generatedMediaFingerprint: current.generatedMediaFingerprint, profileFingerprint: current.profileFingerprint, mode: current.mode, matrixFingerprint: current.matrixFingerprint, environmentFingerprint: current.environmentFingerprint, artifacts: evidence.artifacts.map(({ path, sha256 }) => ({ path, sha256 })) } };
}

/** Produce one gate check per matrix row so omitted cases cannot disappear from the denominator. */
export function evaluateBrowserEvidenceMatrix(evidence: readonly BrowserEvidence[], context: BrowserEvidenceContext): AuditCheck[] {
  return normalizedMatrix(context.matrix).map(({ caseId }) => {
    const matching = evidence.filter((item) => item.caseId === caseId);
    if (matching.length > 1) return { checkId: "BROWSER_EVIDENCE_BINDING", result: "not-verified", message: `Multiple browser evidence records exist for case ${caseId}; select one reviewed record.`, entityId: caseId };
    return evaluateBrowserEvidence(matching[0], context, caseId);
  });
}

function normalizedMatrix(matrix: readonly BrowserMatrixCase[]): BrowserMatrixCase[] {
  if (!Array.isArray(matrix) || matrix.length === 0) throw new TypeError("A non-empty browser matrix is required");
  const ids = new Set<string>();
  return matrix.map((entry) => {
    if (!entry || typeof entry.caseId !== "string" || !entry.caseId.trim() || ids.has(entry.caseId)) throw new TypeError("Browser matrix case IDs must be unique non-empty strings");
    ids.add(entry.caseId);
    return { caseId: entry.caseId, expected: entry.expected };
  }).sort((a, b) => a.caseId.localeCompare(b.caseId, "en"));
}

function normalizedEnvironment(environment: BrowserEnvironment): BrowserEnvironment {
  for (const [key, value] of Object.entries(environment ?? {})) if (typeof value !== "string" || !value.trim()) throw new TypeError(`Browser environment ${key} must be non-empty`);
  for (const key of ["os", "osBuild", "browser", "browserVersion"] as const) if (!(key in environment)) throw new TypeError(`Browser environment ${key} is required`);
  return { os: environment.os.trim(), osBuild: environment.osBuild.trim(), browser: environment.browser.trim(), browserVersion: environment.browserVersion.trim() };
}

function isEvidencePath(path: string): boolean { return EVIDENCE_PATH.test(path) && isSafeRelativePath(path); }
function isSafeRelativePath(path: string): boolean { return path.length > 0 && !path.includes("\\") && !path.includes("\0") && !path.startsWith("/") && !path.split("/").some((part) => part === "" || part === "." || part === ".."); }
function digest(value: unknown): string { return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex"); }
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  throw new TypeError("Browser evidence binding values must be finite JSON data");
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
