import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";

/**
 * A benchmark case may only measure inputs that every clone has. A path that is
 * absent makes the case fail, and a path that is present but ignored by git makes
 * the record irreproducible for anyone else, so both are reported here instead of
 * being handled by an `optional` flag at run time.
 */

/** Repo-relative paths a case definition reads from disk. */
export function fixturePathsOf(definition, root) {
  const found = new Set();
  const visit = (value) => {
    if (typeof value === "string") {
      const path = isAbsolute(value) ? relative(root, value) : value;
      // Virtual paths such as `BDMV/index.bdmv` describe a disc layout, not a file on disk.
      if (isAbsolute(value) && path.startsWith("..")) return;
      if (!path.startsWith("test-data/")) return;
      found.add(path.replace(/\/+$/, ""));
      return;
    }
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value && typeof value === "object") for (const item of Object.values(value)) visit(item);
  };
  visit(definition.options);
  return [...found].sort();
}

function trackedEntries(root, paths) {
  try {
    const output = execFileSync("git", ["ls-files", "-z", "--", ...paths], { cwd: root, maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] });
    return output.toString().split("\u0000").filter(Boolean);
  } catch { return null; }
}

/**
 * @returns {{ missing: Array<{caseId: string, path: string}>, untracked: Array<{caseId: string, path: string}>, checked: boolean }}
 */
export function auditFixtures({ root, definitions }) {
  const paths = new Map();
  for (const definition of definitions) {
    for (const path of fixturePathsOf(definition, root)) paths.set(path, [...(paths.get(path) ?? []), definition.caseId]);
  }
  const missing = [];
  const present = [];
  for (const [path, caseIds] of paths) {
    let exists;
    try { statSync(`${root}${sep}${path}`); exists = true; } catch { exists = false; }
    if (exists) present.push(path);
    else for (const caseId of caseIds) missing.push({ caseId, path });
  }
  const entries = present.length ? trackedEntries(root, present) : [];
  if (entries === null) return { missing, untracked: [], checked: false };
  const presentSet = new Set(present);
  const files = new Set(entries);
  const directories = new Set();
  for (const file of entries) {
    const parts = file.split("/");
    for (let index = 1; index < parts.length; index++) directories.add(parts.slice(0, index).join("/"));
  }
  const untracked = [];
  for (const [path, caseIds] of paths) {
    if (!presentSet.has(path)) continue;
    if (files.has(path) || directories.has(path)) continue;
    for (const caseId of caseIds) untracked.push({ caseId, path });
  }
  return { missing, untracked, checked: true };
}

/** Throws when a case reads a file that is not on disk; untracked fixtures are reported by the caller. */
export function assertFixturesPresent(audit) {
  if (!audit.missing.length) return;
  const lines = audit.missing.map((item) => `  ${item.caseId}: ${item.path}`);
  throw new Error(`Benchmark fixtures are missing:\n${lines.join("\n")}\nRestore them, or drop the case that needs them.`);
}
