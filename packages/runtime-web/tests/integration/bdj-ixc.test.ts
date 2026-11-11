import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const javacAvailable = spawnSync("javac", ["-version"], { encoding: "utf8" }).status === 0;

async function javaSources(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await javaSources(path));
    else if (entry.name.endsWith(".java")) files.push(path);
  }
  return files;
}

it.skipIf(!javacAvailable)("IXC proxies Remote calls between isolated Xlet classloaders", async () => {
  const output = await mkdtemp(join(tmpdir(), "bdmv-host-ixc-"));
  try {
    const compile = spawnSync("javac", ["--release", "8", "-d", output,
      ...await javaSources(join(packageRoot, "bdj-host/src")),
      ...await javaSources(join(packageRoot, "tests/fixtures/bdj-ixc")),
    ], { encoding: "utf8" });
    expect(compile.status, compile.stderr).toBe(0);
    const jar = spawnSync("jar", ["--create", "--file", join(output, "ixc-fixture.jar"), "-C", output, "fixture/ixc"], { encoding: "utf8" });
    expect(jar.status, jar.stderr).toBe(0);
    await rm(join(output, "fixture"), { recursive: true, force: true });
    const run = spawnSync("java", ["-cp", output, "IxcRegistryProbe", join(output, "ixc-fixture.jar")], { encoding: "utf8", timeout: 10_000 });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toContain("IXC_PROXY_OK bidirectional identity exception unbind");
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
