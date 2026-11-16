import { applyInvocationCwd } from "./invocation-cwd.js";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";

const originalCwd = process.cwd();
const created: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bdmv2web-invocation-"));
  created.push(dir);
  // `mkdtemp` reports the temp path; `process.cwd()` reports the resolved one.
  return realpath(dir);
}

describe("invocation working directory", () => {
  afterEach(() => {
    process.chdir(originalCwd);
    delete process.env.INIT_CWD;
  });
  afterAll(async () => {
    await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("resolves relative arguments from the directory the command was typed in", async () => {
    const typed = await tempDir();
    const launched = await tempDir();
    process.chdir(launched);
    process.env.INIT_CWD = typed;
    applyInvocationCwd();
    expect(process.cwd()).toBe(typed);
  });

  it("keeps the inherited directory when the caller already works there", async () => {
    const dir = await tempDir();
    process.chdir(dir);
    process.env.INIT_CWD = dir;
    applyInvocationCwd();
    expect(process.cwd()).toBe(dir);
  });

  it("keeps the inherited directory when the caller exported no INIT_CWD", async () => {
    const dir = await tempDir();
    process.chdir(dir);
    applyInvocationCwd();
    expect(process.cwd()).toBe(dir);
  });

  it("keeps the inherited directory when INIT_CWD no longer exists", async () => {
    const dir = await tempDir();
    process.chdir(dir);
    process.env.INIT_CWD = join(dir, "deleted");
    applyInvocationCwd();
    expect(process.cwd()).toBe(dir);
  });
});
