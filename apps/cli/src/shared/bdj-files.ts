import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveInputFile } from "@bdmv2web/bdmv-io";
import type { ParsedDisc } from "@bdmv2web/bdmv-parser";

export interface BdjFilePayload {
  path: string;
  sourcePath: string;
  bytes: Uint8Array;
}

export interface BdjFileCollection {
  files: BdjFilePayload[];
  diagnostics: Array<{ code: string; message: string; severity: "warning" }>;
}

function applicationJarPath(basePath: string): string | null {
  const normalized = basePath.replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = normalized.split("/");
  if (!normalized || normalized.startsWith("/") || segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  const jarPath = /\.jar$/i.test(normalized) ? normalized : `${normalized}.jar`;
  return `JAR/${jarPath}`;
}

/** Read the BD-J application directory into package-local VFS files. */
export async function collectBdjApplicationFiles(disc: ParsedDisc): Promise<BdjFileCollection> {
  if (!disc.bdjos?.length) return { files: [], diagnostics: [] };
  const files: BdjFilePayload[] = [];
  const diagnostics: BdjFileCollection["diagnostics"] = [];
  const jarRoot = resolve(disc.root, "JAR");

  const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`BD-J package input contains a symbolic link: BDMV/JAR/${relativePath}`);
      if (entry.isDirectory()) { await visit(absolutePath, relativePath); continue; }
      if (!entry.isFile()) continue;
      const inputPath = `JAR/${relativePath}`;
      const validatedPath = await resolveInputFile(disc.root, inputPath);
      files.push({ path: `BDMV/${inputPath}`, sourcePath: `BDMV/${inputPath}`, bytes: new Uint8Array(await readFile(validatedPath)) });
    }
  };

  await visit(jarRoot, "");
  const byPath = new Map(files.map((file) => [file.path.toLocaleLowerCase("en-US"), file]));
  for (const bdjo of disc.bdjos) {
    for (const application of bdjo.applications) {
      const applicationPath = applicationJarPath(application.basePath);
      if (!applicationPath) {
        diagnostics.push({ code: "BDJ_APPLICATION_BASE_PATH_INVALID", severity: "warning", message: `BDJO ${bdjo.path} app ${application.applicationId} has an invalid JAR basePath '${application.basePath}'.` });
        continue;
      }
      if (!byPath.has(`BDMV/${applicationPath}`.toLocaleLowerCase("en-US"))) {
        diagnostics.push({ code: "BDJ_APPLICATION_JAR_MISSING", severity: "warning", message: `BDJO ${bdjo.path} app ${application.applicationId} requires ${applicationPath}, but the file is missing from the BDMV input.` });
      }
    }
  }
  return { files, diagnostics };
}
