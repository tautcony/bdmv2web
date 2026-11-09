import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

export async function directoryBytesExcluding(root: string, excludedPath: string): Promise<bigint> {
  let total = 0n;
  const visit = async (directory: string): Promise<void> => {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (path === excludedPath) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) total += BigInt((await stat(path)).size);
    }
  };
  await visit(root);
  return total;
}
