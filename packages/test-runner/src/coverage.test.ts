import { describe, expect, it } from "vitest";
import { summarizeCoverage, summarizeDeliveryCoverage } from "./coverage.js";

describe("M6 named coverage populations", () => {
  it("adapts entry, instruction, media and test counts without hiding failed or unknown items", () => {
    const report = summarizeDeliveryCoverage({
      entries: { total: 2, passed: 1, failed: 1, evidenceComplete: true },
      instructions: { total: 4, passed: 3, unknown: 1, evidenceComplete: true },
      media: { total: 2, passed: 1, failed: 1, evidenceComplete: true },
      tests: { total: 3, passed: 2, failed: 1, evidenceComplete: true },
    });

    expect(report.entries).toMatchObject({ status: "incomplete", denominator: 2, passed: 1, failed: 1, unknown: 0, percent: 50, complete: false });
    expect(report.instructions).toMatchObject({ status: "incomplete", denominator: 4, passed: 3, failed: 0, unknown: 1, percent: 75, complete: false });
    expect(report.media).toMatchObject({ status: "incomplete", denominator: 2, passed: 1, failed: 1, unknown: 0, percent: 50, complete: false });
    expect(report.tests).toMatchObject({ status: "incomplete", denominator: 3, passed: 2, failed: 1, unknown: 0, percent: 66.67, complete: false });
  });

  it("keeps exploration-budget exhaustion unknown even when visited items all passed", () => {
    expect(summarizeCoverage({ total: 4, passed: 4, evidenceComplete: true, explorationBudgetExceeded: true })).toMatchObject({
      status: "N/A", denominator: null, passed: 4, unknown: 1, percent: null, complete: false,
      reason: expect.stringContaining("Exploration budget was exhausted"),
    });
  });

  it("reports zero applicable items as N/A with a reason", () => {
    expect(summarizeCoverage({ total: 0 })).toMatchObject({
      status: "N/A", denominator: 0, passed: 0, failed: 0, unknown: 0, percent: null, complete: false,
      reason: expect.stringContaining("no applicable items"),
    });
  });

  it("reports an unspecified population as N/A", () => {
    expect(summarizeCoverage({ passed: 3 })).toMatchObject({
      status: "N/A", denominator: null, passed: 3, percent: null, complete: false,
      reason: expect.stringContaining("denominator is unknown"),
    });
  });
});
