import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** Repository-relative form of a path, or null when the path lies outside the root. */
export function toPortablePath(root, path) {
  if (!path) return null;
  const absolute = isAbsolute(path) ? path : resolve(root, path);
  return absolute.startsWith(root) ? relative(root, absolute).replaceAll("\\", "/") : null;
}

/** Build a temporary canonical BDMV directory from fixture files and their logical paths. */
export async function materializeBdmvFiles(fixtureRoot, files) {
  const tempRoot = await mkdtemp(resolve(tmpdir(), "bdmv2web-perf-bdmv-"));
  const directory = resolve(tempRoot, "BDMV");
  try {
    for (const file of files) {
      if (!file || typeof file.path !== "string" || typeof file.virtualPath !== "string") throw new TypeError("Each BDMV fixture file needs path and virtualPath strings");
      const source = isAbsolute(file.path) ? file.path : resolve(fixtureRoot, file.path);
      const target = resolve(tempRoot, file.virtualPath);
      const fromRoot = relative(tempRoot, target);
      if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) throw new Error(`BDMV virtual path escapes fixture tree: ${file.virtualPath}`);
      if (relative(directory, target) === ".." || relative(directory, target).startsWith(`..${sep}`)) throw new Error(`BDMV virtual path must stay inside BDMV/: ${file.virtualPath}`);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
    }
    return { directory, cleanup: () => rm(tempRoot, { recursive: true, force: true }) };
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
}
