import { describe, expect, it } from "vitest";
import { runControlledProcess, runMonitoredProcess } from "./process-control.js";

describe("runMonitoredProcess", () => {
  it("aborts and waits for the process when a write exceeds its limit", async () => {
    let stopped = false;
    const exceeded = new Error("limit exceeded");
    await expect(runMonitoredProcess({
      run: (signal) => new Promise<void>((resolve) => signal.addEventListener("abort", () => { stopped = true; resolve(); }, { once: true })),
      check: async () => { throw exceeded; },
      monitorError: (error) => error as Error,
    })).rejects.toBe(exceeded);
    expect(stopped).toBe(true);
  });

  it("checks completed output before returning the result", async () => {
    const phases: string[] = [];
    const result = await runMonitoredProcess({
      run: async () => "done",
      check: async (phase) => { phases.push(phase); },
      monitorError: (error) => error as Error,
    });
    expect(result).toBe("done");
    expect(phases).toEqual(["during encoding", "at process completion"]);
  });
});

describe("runControlledProcess", () => {
  it("aborts the process and reports the cancellation", async () => {
    const controller = new AbortController();
    const cancelled = new Error("cancelled");
    let stopped = false;
    const result = runControlledProcess({
      run: (signal) => new Promise<void>((resolve) => signal.addEventListener("abort", () => { stopped = true; resolve(); }, { once: true })),
      signals: [controller.signal], timeoutMs: 1000,
      cancellationError: () => cancelled,
      timeoutError: () => new Error("timeout"),
      processError: (error) => error as Error,
    });
    controller.abort();
    await expect(result).rejects.toBe(cancelled);
    expect(stopped).toBe(true);
  });

  it("aborts the process and reports the timeout", async () => {
    const timeout = new Error("timeout");
    let stopped = false;
    await expect(runControlledProcess({
      run: (signal) => new Promise<void>((resolve) => signal.addEventListener("abort", () => { stopped = true; resolve(); }, { once: true })),
      signals: [], timeoutMs: 10,
      cancellationError: () => new Error("cancelled"),
      timeoutError: () => timeout,
      processError: (error) => error as Error,
    })).rejects.toBe(timeout);
    expect(stopped).toBe(true);
  });
});
