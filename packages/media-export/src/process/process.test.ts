import { describe, expect, it } from "vitest";
import { MediaJobError, runMediaProcess } from "./process.js";

describe("media process runner", () => {
  it("collects output and reports ffmpeg progress records", async () => {
    const progress: Array<{ outTimeSeconds: number; state: "continue" | "end" }> = [];
    const result = await runMediaProcess(process.execPath, [
      "-e",
      "process.stdout.write('ready'); process.stderr.write('out_time_us=1500000\\nprogress=continue\\n')",
    ], 5_000, undefined, (item) => progress.push(item));

    expect(result).toEqual({ stdout: "ready", stderr: "out_time_us=1500000\nprogress=continue\n" });
    expect(progress).toEqual([{ outTimeSeconds: 1.5, state: "continue" }]);
  });

  it("rejects a failed child with its exit status and stderr", async () => {
    await expect(runMediaProcess(process.execPath, ["-e", "process.stderr.write('encoder failed'); process.exit(7)"], 5_000))
      .rejects.toThrow("exited 7: encoder failed");
  });

  it("rejects when the operating system cannot start the executable", async () => {
    await expect(runMediaProcess("bdmv2web-missing-media-tool", [], 5_000)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("terminates a child after the timeout and reports the timeout code", async () => {
    const result = runMediaProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], 20);

    await expect(result).rejects.toMatchObject({
      name: "MediaJobError",
      diagnostic: { code: "MEDIA_JOB_TIMEOUT", message: expect.any(String) },
    } satisfies Partial<MediaJobError>);
  });

  it("cancels a child when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(runMediaProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], 5_000, controller.signal))
      .rejects.toMatchObject({
        name: "MediaJobError",
        diagnostic: { code: "MEDIA_JOB_CANCELLED", message: expect.any(String) },
      } satisfies Partial<MediaJobError>);
  });

  it("stops and rejects when combined child output exceeds the capture limit", async () => {
    await expect(runMediaProcess(process.execPath, ["-e", "process.stdout.write(Buffer.alloc(5 * 1024 * 1024))"], 5_000))
      .rejects.toMatchObject({
        name: "MediaJobError",
        diagnostic: { code: "MEDIA_PROCESS_FAILED", message: expect.any(String) },
      } satisfies Partial<MediaJobError>);
  });
});
