export interface CoverageCounts {
  /** The declared denominator. Omit it when the population is unknown. */
  total?: number;
  passed?: number;
  failed?: number;
  unknown?: number;
  reason?: string;
  evidenceComplete?: boolean;
  /** A bounded exploration stopped before the reachable population was known. */
  explorationBudgetExceeded?: boolean;
}

/**
 * Coverage inputs use passed for supported/resolved/exported/verified items,
 * failed for unsupported/invalid/missing/failed items, and unknown for items
 * that could not be classified. `total` is the category population, not the
 * number of items visited so far.
 */
/** `passed` means counted as a usable declared/reachable entry. */
export type EntryCoverageCounts = CoverageCounts;
/** `passed` means the instruction is supported; unresolved encodings are unknown. */
export type InstructionCoverageCounts = CoverageCounts;
/** `passed` means required media was exported; missing required media is failed. */
export type MediaCoverageCounts = CoverageCounts;
/** `passed` means a required test was verified; unrun/unverified tests are unknown. */
export type TestCoverageCounts = CoverageCounts;

/** Named M6 populations; callers must provide every category explicitly. */
export interface DeliveryCoverageInput {
  entries: EntryCoverageCounts;
  instructions: InstructionCoverageCounts;
  media: MediaCoverageCounts;
  tests: TestCoverageCounts;
}

export interface CoverageSummary {
  status: "measured" | "incomplete" | "N/A";
  denominator: number | null;
  passed: number;
  failed: number;
  /** At budget exhaustion this is a lower bound; the denominator is null. */
  unknown: number;
  percent: number | null;
  complete: boolean;
  reason?: string;
}

function count(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Coverage counts must be non-negative safe integers");
  return value;
}

export function summarizeCoverage(input: CoverageCounts): CoverageSummary {
  const passed = count(input.passed);
  const failed = count(input.failed);
  const reportedUnknown = count(input.unknown);
  if (input.explorationBudgetExceeded) {
    return {
      status: "N/A",
      denominator: null,
      passed,
      failed,
      unknown: Math.max(reportedUnknown, 1),
      percent: null,
      complete: false,
      reason: input.reason ?? "Exploration budget was exhausted before the category population was known.",
    };
  }
  const unknown = reportedUnknown;
  if (input.total === undefined || input.total === 0) {
    return { status: "N/A", denominator: input.total ?? null, passed, failed, unknown, percent: null, complete: false, reason: input.reason ?? (input.total === 0 ? "The category has no applicable items." : "The population denominator is unknown.") };
  }
  const denominator = count(input.total);
  const accounted = passed + failed + unknown;
  const bounded = Number.isSafeInteger(accounted) && accounted <= denominator;
  const allAccounted = accounted === denominator;
  const complete = bounded && allAccounted && failed === 0 && unknown === 0 && input.evidenceComplete === true;
  const percent = bounded && input.evidenceComplete === true ? Math.round((passed / denominator) * 10_000) / 100 : null;
  return {
    status: complete ? "measured" : "incomplete",
    denominator,
    passed,
    failed,
    unknown: unknown + (bounded ? denominator - accounted : 0),
    percent,
    complete,
    ...(!bounded ? { reason: "Reported item counts exceed the denominator." } : !allAccounted ? { reason: "Some denominator items have no classified result." } : !input.evidenceComplete ? { reason: "Per-item evidence is incomplete." } : failed > 0 ? { reason: "One or more items failed." } : unknown > 0 ? { reason: "One or more items remain unknown." } : {}),
  };
}

export type CoverageReport = Record<string, CoverageSummary>;

export interface DeliveryCoverageReport extends CoverageReport {
  entries: CoverageSummary;
  instructions: CoverageSummary;
  media: CoverageSummary;
  tests: CoverageSummary;
}

export function summarizeCoverageReport(input: Record<string, CoverageCounts>): CoverageReport {
  return Object.fromEntries(Object.entries(input).map(([name, counts]) => [name, summarizeCoverage(counts)]));
}

/** Adapt the four named M6 populations to the common coverage report shape. */
export function summarizeDeliveryCoverage(input: DeliveryCoverageInput): DeliveryCoverageReport {
  return summarizeCoverageReport({ entries: input.entries, instructions: input.instructions, media: input.media, tests: input.tests }) as DeliveryCoverageReport;
}

export function isCoverageReportComplete(report: CoverageReport): boolean {
  const summaries = Object.values(report);
  return summaries.length > 0 && summaries.every((summary) =>
    summary.complete || (summary.status === "N/A" && summary.denominator === 0 && typeof summary.reason === "string" && summary.reason.trim().length > 0),
  );
}
