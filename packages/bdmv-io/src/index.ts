import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Limits } from "@bdmv-web/core";
import { ContractError, DEFAULT_LIMITS } from "@bdmv-web/core";

function within(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export async function canonicalDirectory(path: string): Promise<string> {
  const canonical = await realpath(path);
  if (!(await stat(canonical)).isDirectory()) throw new ContractError("PATH_NOT_DIRECTORY", path, "Expected a directory");
  return canonical;
}

export async function assertDisjointRoots(inputPath: string, outputPath: string, cachePath?: string): Promise<{ input: string; output: string; cache?: string }> {
  const input = await canonicalDirectory(inputPath);
  const output = resolve(outputPath);
  const outputParent = await realpath(dirname(output));
  const canonicalOutput = resolve(outputParent, basename(output));
  let cache: string | undefined;
  if (cachePath) cache = await canonicalDirectory(cachePath);
  if (within(input, canonicalOutput) || within(canonicalOutput, input)) throw new ContractError("PATH_OVERLAP", outputPath, "Input and output directories must not overlap");
  if (cache && (within(input, cache) || within(cache, input) || within(canonicalOutput, cache) || within(cache, canonicalOutput))) throw new ContractError("PATH_OVERLAP", cachePath!, "Cache must be disjoint from input and output");
  return { input, output: canonicalOutput, ...(cache ? { cache } : {}) };
}

export async function resolveInputFile(root: string, relativePath: string): Promise<string> {
  const canonicalRoot = await canonicalDirectory(root);
  if (isAbsolute(relativePath)) throw new ContractError("PATH_ESCAPE", relativePath, "Absolute paths are not allowed");
  const normalized = resolve(canonicalRoot, relativePath);
  if (!within(canonicalRoot, normalized)) throw new ContractError("PATH_ESCAPE", relativePath, "Path escapes the input root");
  const resolved = await realpath(normalized);
  if (!within(canonicalRoot, resolved)) throw new ContractError("PATH_ESCAPE", relativePath, "Symlink target escapes the input root");
  if (!(await stat(resolved)).isFile()) throw new ContractError("PATH_NOT_FILE", relativePath, "Expected a file");
  return resolved;
}

export interface InputFileTable {
  readonly root: string;
  readonly files: ReadonlyMap<string, string>;
}

export async function buildInputFileTable(rootPath: string, relativePaths: string[]): Promise<InputFileTable> {
  const root = await canonicalDirectory(rootPath);
  const files = new Map<string, string>();
  for (const relativePath of relativePaths) {
    if (relativePath.includes("\\") || relativePath.startsWith("/") || relativePath.split("/").some((part) => part === ".." || part === "." || part === "")) {
      throw new ContractError("PATH_ESCAPE", relativePath, "File table paths must be normalized relative POSIX paths");
    }
    if (files.has(relativePath)) throw new ContractError("DUPLICATE_FILE_PATH", relativePath, "File path is already in the input table");
    files.set(relativePath, await resolveInputFile(root, relativePath));
  }
  return { root, files };
}

export function resolveFileReference(table: InputFileTable, relativePath: string): string {
  const resolved = table.files.get(relativePath);
  if (!resolved) throw new ContractError("FILE_NOT_REGISTERED", relativePath, "Input reference is not present in the validated file table");
  return resolved;
}

export async function* readFileChunks(path: string, limits: Limits = DEFAULT_LIMITS, chunkSize = 1024 * 1024): AsyncGenerator<Uint8Array> {
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0 || chunkSize > limits.maxReadWindowBytes) throw new ContractError("LIMIT_EXCEEDED", "/chunkSize", "Chunk size exceeds maxReadWindowBytes");
  const stream = createReadStream(path, { highWaterMark: chunkSize });
  for await (const chunk of stream) yield chunk as Uint8Array;
}

export async function hashFile(path: string, limits?: Limits): Promise<{ sha256: string; byteLength: bigint }> {
  const hash = createHash("sha256"); let byteLength = 0n;
  for await (const chunk of readFileChunks(path, limits)) { hash.update(chunk); byteLength += BigInt(chunk.byteLength); }
  return { sha256: hash.digest("hex"), byteLength };
}

export async function sourceFingerprint(rootPath: string): Promise<string> {
  const root = await canonicalDirectory(rootPath);
  const files: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const path = resolve(dir, entry.name);
      if (entry.isSymbolicLink()) throw new ContractError("SYMLINK_REJECTED", path, "Symlinks are not accepted in a source tree");
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  await visit(root);
  const hash = createHash("sha256");
  for (const path of files.sort((a, b) => relative(root, a).localeCompare(relative(root, b), "en"))) {
    const rel = relative(root, path).split(sep).join("/");
    const result = await hashFile(path);
    hash.update(rel).update("\0").update(result.sha256).update("\n");
  }
  return hash.digest("hex");
}

export function assetIdFromSha256(sha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new ContractError("INVALID_SHA256", "/sha256", "Expected lowercase SHA-256 hex");
  return `sha256-${sha256}`;
}

export async function payloadFingerprint(rootPath: string, reportPaths: string[] = ["reports.json"]): Promise<string> {
  const root = await canonicalDirectory(rootPath);
  const excluded = new Set(reportPaths.map((p) => p.split(sep).join("/")));
  const files: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const path = resolve(dir, entry.name);
      if (entry.isSymbolicLink()) throw new ContractError("SYMLINK_REJECTED", path, "Symlinks are not accepted in a payload tree");
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const rel = relative(root, path).split(sep).join("/");
        if (!excluded.has(rel)) files.push(path);
      }
    }
  };
  await visit(root);
  const hash = createHash("sha256");
  for (const path of files.sort((a, b) => relative(root, a).localeCompare(relative(root, b), "en"))) {
    const rel = relative(root, path).split(sep).join("/");
    const result = await hashFile(path);
    hash.update(rel).update("\0").update(result.sha256).update("\n");
  }
  return hash.digest("hex");
}

export function assertByteLimit(value: number | bigint, maxBytes: number, path = "/byteLength"): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new ContractError("INVALID_LIMIT", "/maxBytes", "Limit must be a positive safe integer");
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) throw new ContractError("INVALID_LENGTH", path, "Byte length must be a non-negative safe integer");
  if (typeof value === "bigint" && value < 0n) throw new ContractError("INVALID_LENGTH", path, "Byte length must be non-negative");
  if (BigInt(value) > BigInt(maxBytes)) throw new ContractError("LIMIT_EXCEEDED", path, `Value exceeds ${maxBytes} byte limit`);
}

export interface OutputTransaction { readonly stagingPath: string; commit(): Promise<void>; abort(): Promise<void> }

export async function beginOutputTransaction(targetPath: string): Promise<OutputTransaction> {
  const target = resolve(targetPath);
  const parent = await realpath(dirname(target));
  const canonicalTarget = resolve(parent, basename(target));
  try { await lstat(canonicalTarget); throw new ContractError("TARGET_EXISTS", targetPath, "Output target already exists"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const stageBase = await mkdtemp(resolve(parent, `.${basename(target)}.staging-`));
  let closed = false;
  return {
    stagingPath: stageBase,
    async commit() {
      if (closed) throw new ContractError("TRANSACTION_CLOSED", targetPath, "Transaction is already closed");
      try {
        try { await lstat(canonicalTarget); throw new ContractError("TARGET_EXISTS", targetPath, "Output target already exists"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        await rename(stageBase, canonicalTarget); closed = true;
      }
      catch (error) { await rm(stageBase, { recursive: true, force: true }); closed = true; throw error; }
    },
    async abort() { if (!closed) { await rm(stageBase, { recursive: true, force: true }); closed = true; } },
  };
}

export async function checkedFileSize(path: string, maxBytes: number): Promise<number> {
  const handle = await open(path, "r");
  try {
    const size = (await handle.stat()).size;
    if (!Number.isSafeInteger(size) || size > maxBytes) throw new ContractError("LIMIT_EXCEEDED", path, `File exceeds ${maxBytes} byte limit`);
    return size;
  } finally { await handle.close(); }
}
