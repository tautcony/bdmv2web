import { describe, expect, it } from "vitest";
import { createReferenceCompareReport } from "./report.js";

const input = {
  fixtureId: "synthetic-call-resume-01",
  sourceLabel: "local synthetic navigation fixture",
  playerProfile: {
    menuLanguage: "eng", audioLanguage: "eng", subtitleLanguage: "eng", country: "US", region: "A",
    outputProfile: "portable", videoProfiles: [], audioProfiles: [],
  },
  initialRegisters: { PSR0: 1, GPR0: "0" },
  stableEntry: "object-0",
  seed: 7,
  events: [{ at90k: "0", type: "key", key: "enter" }, { at90k: "90000", type: "media-ended" }],
};

describe("reference compare adapter", () => {
  it("binds the validated input, trace comparison, and pinned tool metadata", () => {
    const trace = [{ pc: 2, registers: { PSR1: 3 }, source: { path: "BDMV/MovieObject.bdmv", offset: "54" } }];
    const report = createReferenceCompareReport({
      input,
      actualTrace: trace,
      reference: { trace, tool: { name: "ReferenceVM", version: "1.2.3", invocation: "reference-vm --fixture synthetic-call-resume-01" } },
    });

    expect(report).toMatchObject({
      fixtureId: input.fixtureId, sourceLabel: input.sourceLabel, input,
      referenceTool: { name: "ReferenceVM", version: "1.2.3", invocation: expect.stringContaining(input.fixtureId) },
      result: "pass", comparison: { equal: true, count: 1 },
    });
  });

  it("marks absent reference evidence not verified and retains the input label and reason", () => {
    const report = createReferenceCompareReport({ input, actualTrace: [{ pc: 2 }] });
    expect(report).toMatchObject({
      fixtureId: input.fixtureId, sourceLabel: input.sourceLabel, input,
      referenceTool: null, referenceTrace: null, result: "not-verified", comparison: null,
      reason: expect.stringContaining("No independent reference trace was supplied"),
    });
  });

  it("does not pass a comparison when the reference tool version is missing", () => {
    const trace = [{ pc: 2 }];
    const report = createReferenceCompareReport({
      input,
      actualTrace: trace,
      reference: { trace, tool: { name: "ReferenceVM", version: null, invocation: "reference-vm --fixture synthetic-call-resume-01" } },
    });
    expect(report).toMatchObject({ result: "not-verified", comparison: { equal: true, count: 1 }, reason: expect.stringContaining("version was not recorded") });
  });
});
