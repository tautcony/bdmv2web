import type { commandProgress } from "../progress.js";

/**
 * Final build result. `status`/`exitCode` come from `decideDelivery()`; this
 * module publishes them.
 */
export interface BuildOutcome {
  status: "complete" | "partial" | "failed";
  exitCode: 0 | 1;
  output: string;
  launch?: string;
  /** Conversion failure code, reported by the failure path. */
  code?: string;
}

/**
 * The single exit for a build run: finish progress, write the one stdout JSON
 * record and set the process exit code. The HDMV, BD-J and failure paths all
 * exit here, and every run sets `process.exitCode` from its own result.
 */
export function publishBuildOutcome(
  result: BuildOutcome,
  progress: ReturnType<typeof commandProgress>,
  details: ReadonlyArray<readonly [string, string]>,
): void {
  progress.finish(result.status, details, result.code);
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    ...(result.code === undefined ? {} : { code: result.code }),
    output: result.output,
    ...(result.launch === undefined ? {} : { launch: result.launch }),
  })}\n`);
  process.exitCode = result.exitCode;
}
