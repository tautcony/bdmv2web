import { afterEach, describe, expect, it, vi } from "vitest";
import { ProgressReporter } from "../progress.js";
import { publishBuildOutcome } from "./build-outcome.js";

function reporter(): { progress: ProgressReporter; text: () => string } {
  const chunks: string[] = [];
  const stream = { isTTY: false, write: (chunk: string) => { chunks.push(chunk); return true; } } as unknown as NodeJS.WriteStream;
  return { progress: new ProgressReporter({ command: "build", steps: ["report"], mode: "plain", stream }), text: () => chunks.join("") };
}

describe("build outcome", () => {
  const previousExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = previousExitCode;
    vi.restoreAllMocks();
  });

  it("writes one stdout record, finishes progress and sets exit 0 for a complete build", () => {
    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => { stdout.push(String(chunk)); return true; });
    const { progress, text } = reporter();

    publishBuildOutcome({ status: "complete", exitCode: 0, output: "/out" }, progress, [["output", "/out"]]);

    expect(JSON.parse(stdout.join(""))).toEqual({ status: "complete", output: "/out" });
    expect(text()).toContain("Done in");
    expect(process.exitCode).toBe(0);
  });

  it("reports the launch command for a BD-J result", () => {
    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => { stdout.push(String(chunk)); return true; });
    const { progress } = reporter();

    publishBuildOutcome({ status: "partial", exitCode: 0, output: "/out", launch: "bdmv2web serve /out" }, progress, []);

    expect(JSON.parse(stdout.join(""))).toEqual({ status: "partial", output: "/out", launch: "bdmv2web serve /out" });
    expect(process.exitCode).toBe(0);
  });

  it("keeps the failure code and sets exit 1 on the shared exit", () => {
    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => { stdout.push(String(chunk)); return true; });
    process.exitCode = 0;
    const { progress, text } = reporter();

    publishBuildOutcome({ status: "failed", exitCode: 1, output: "/out", code: "MENU_SCENE_NOT_FOUND" }, progress, [["report", "reports.json · status failed"]]);

    expect(JSON.parse(stdout.join(""))).toEqual({ status: "failed", code: "MENU_SCENE_NOT_FOUND", output: "/out" });
    expect(text()).toContain("Failed in");
    expect(text()).toContain("MENU_SCENE_NOT_FOUND");
    expect(process.exitCode).toBe(1);
  });
});
