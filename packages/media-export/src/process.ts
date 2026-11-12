import { spawn } from "node:child_process";
import type { MediaProcessProgress, MediaProcessResult, MediaProcessRunner } from "./media-types.js";

export class MediaToolError extends Error {
  constructor(readonly diagnostic: { code: "MEDIA_TOOL_UNAVAILABLE" | "MEDIA_TOOL_COMMAND_FAILED" | "MEDIA_ENCODER_UNAVAILABLE"; executable: string; args: string[]; message: string }) {
    super(diagnostic.message);
    this.name = "MediaToolError";
  }
}
export type MediaJobErrorCode = "MEDIA_JOB_CANCELLED" | "MEDIA_JOB_TIMEOUT" | "MEDIA_PROCESS_FAILED" | "MEDIA_OUTPUT_INVALID";
export class MediaJobError extends Error {
  constructor(readonly diagnostic: { code: MediaJobErrorCode; executable?: string; args?: string[]; message: string }) {
    super(diagnostic.message);
    this.name = "MediaJobError";
  }
}
async function runProcess(executable: string, args: string[], timeoutMs: number, signal?: AbortSignal, onProgress?: (progress: MediaProcessProgress) => void): Promise<MediaProcessResult> {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = []; const stderr: Buffer[] = []; let size = 0; let finished = false; let requestedError: Error | undefined; let killTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, result?: MediaProcessResult) => {
      if (finished) return; finished = true; clearTimeout(timer); if (killTimer) clearTimeout(killTimer); signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolveResult(result!);
    };
    const terminate = (error: Error) => {
      requestedError ??= error;
      child.kill("SIGTERM");
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), 1000);
    };
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > 4 * 1024 * 1024) { terminate(new MediaJobError({ code: "MEDIA_PROCESS_FAILED", executable, args: [...args], message: `${executable} output exceeded 4 MiB.` })); return; }
      target.push(chunk);
    };
    let progressOutput = "";
    let progressFields: Record<string, string> = {};
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", (chunk: Buffer) => {
      collect(stderr)(chunk);
      if (!onProgress) return;
      progressOutput += chunk.toString("utf8");
      const lines = progressOutput.split(/\r?\n/);
      progressOutput = lines.pop() ?? "";
      for (const line of lines) {
        const separator = line.indexOf("=");
        if (separator < 1) continue;
        const key = line.slice(0, separator);
        const value = line.slice(separator + 1);
        progressFields[key] = value;
        if (key === "progress" && (value === "continue" || value === "end")) {
          const micros = Number(progressFields.out_time_us);
          if (Number.isFinite(micros) && micros >= 0) onProgress({ outTimeSeconds: micros / 1_000_000, state: value });
          progressFields = {};
        }
      }
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code, closeSignal) => {
      if (requestedError) return finish(requestedError);
      if (code !== 0) return finish(new Error(`${executable} exited ${code ?? closeSignal}: ${Buffer.concat(stderr).toString("utf8").trim()}`));
      finish(undefined, { stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
    const timer = setTimeout(() => terminate(new MediaJobError({ code: "MEDIA_JOB_TIMEOUT", executable, args: [...args], message: `${executable} timed out after ${timeoutMs} ms.` })), timeoutMs);
    const abort = () => terminate(new MediaJobError({ code: "MEDIA_JOB_CANCELLED", executable, args: [...args], message: `${executable} was cancelled.` }));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export const runMediaProcess: MediaProcessRunner = runProcess;
