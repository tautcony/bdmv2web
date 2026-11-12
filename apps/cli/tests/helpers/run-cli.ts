import { createRequire } from "node:module";
import { vi } from "vitest";
import { runCli } from "../../src/cli/run.js";

const { version } = createRequire(import.meta.url)("../../package.json") as { version: string };

export async function runCommand(args: string[], options: { env?: NodeJS.ProcessEnv } = {}): Promise<{ status: number; stdout: string; stderr: string }> {
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const previousEnv = process.env;
  let stdout = "";
  let stderr = "";
  const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => { stdout += String(chunk); return true; });
  const err = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => { stderr += String(chunk); return true; });
  try {
    process.argv = [process.execPath, "bdmv2web", ...args];
    process.exitCode = 0;
    if (options.env) process.env = { ...options.env };
    await runCli(version);
    return { status: Number(process.exitCode ?? 0), stdout, stderr };
  } finally {
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
    process.env = previousEnv;
    out.mockRestore();
    err.mockRestore();
  }
}
