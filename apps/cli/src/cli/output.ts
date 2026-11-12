import { errorText } from "@bdmv2web/utils";
import { link, lstat, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

export function printTable(title: string, columns: string[], rows: Array<Array<string | number | null | undefined>>): void {
  const values = rows.map((row) => row.map((value) => value === null || value === undefined ? "-" : String(value)));
  const widths = columns.map((column, i) => Math.max(column.length, ...values.map((row) => row[i]?.length ?? 0)));
  process.stdout.write(`${title}\n`);
  process.stdout.write(`${columns.map((column, i) => column.padEnd(widths[i]!)).join("  ")}\n`);
  process.stdout.write(`${widths.map((width) => "-".repeat(width)).join("  ")}\n`);
  for (const row of values) process.stdout.write(`${row.map((value, i) => value.padEnd(widths[i]!)).join("  ")}\n`);
}

export async function writeJsonFile(targetPath: string, json: string): Promise<void> {
  const target = resolve(targetPath);
  const temp = resolve(dirname(target), `.${basename(target)}.tmp-${process.pid}`);
  try { await writeFile(temp, json, { flag: "wx" }); await link(temp, target); await unlink(temp); }
  catch (error) { await rm(temp, { force: true }); throw error; }
}

export async function readJsonObject(path: string, onError?: (message: string) => void): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch (error) { onError?.(errorText(error)); return {}; }
}

export async function writeGeneratedReport(root: string, relativePath: string, content: string): Promise<void> {
  const reportPath = resolve(root, relativePath);
  const parentPath = dirname(reportPath);
  try {
    const parent = await lstat(parentPath);
    if (parent.isSymbolicLink() || !parent.isDirectory()) throw new Error(`Report directory is not a regular directory: ${relativePath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(parentPath, { recursive: true });
  }
  try {
    const existing = await lstat(reportPath);
    if (existing.isSymbolicLink() || !existing.isFile()) throw new Error(`Report target is not a regular file: ${relativePath}`);
    await writeFile(reportPath, content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(reportPath, content, { flag: "wx" });
  }
}
