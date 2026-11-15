#!/usr/bin/env node
// Workspace imports resolve through each package's built declarations, and the
// CLI integration tests spawn the built executable. Build once when those
// artifacts are missing; stay silent when a build stage already produced them.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function builtEntries(pkg) {
  const bins = typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin ?? {});
  return [pkg.types, pkg.main, ...bins].filter((entry) => typeof entry === "string" && entry.includes("dist/"));
}

function missingArtifacts() {
  const missing = [];
  for (const group of ["packages", "apps"]) {
    const groupDir = join(root, group);
    for (const name of readdirSync(groupDir)) {
      const pkgFile = join(groupDir, name, "package.json");
      if (!existsSync(pkgFile)) continue;
      const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
      for (const entry of builtEntries(pkg)) {
        if (!existsSync(join(groupDir, name, entry))) missing.push(`${group}/${name}/${entry}`);
      }
    }
  }
  return missing;
}

const missing = missingArtifacts();
if (missing.length > 0) {
  console.log(`[ensure-build] generating ${missing.length} workspace artifact(s) with pnpm build.`);
  const [command, ...prefix] = (process.env.PNPM ?? "corepack pnpm").trim().split(/\s+/);
  const result = spawnSync(command, [...prefix, "build"], { cwd: root, stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}
