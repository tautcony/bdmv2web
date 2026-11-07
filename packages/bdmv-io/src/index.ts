import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Limits } from "@bdmv2web/core";
import { ContractError, DEFAULT_LIMITS } from "@bdmv2web/core";
import { selectBdmvChild } from "./bdmv-candidate.js";

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

/**
 * Resolve the BDMV root of an input path (a BDMV directory or its direct parent)
 * without walking the tree, so callers can name paths before a full discovery.
 */
export async function locateBdmvRoot(inputPath: string): Promise<string> {
  const requested = resolve(inputPath);
  if ((await lstat(requested)).isSymbolicLink()) throw new ContractError("SYMLINK_REJECTED", inputPath, "Input root symlinks are not accepted");
  const canonical = await realpath(requested);
  if (!(await stat(canonical)).isDirectory()) throw new ContractError("PATH_NOT_DIRECTORY", inputPath, "Expected a BDMV root or its direct parent");
  if (basename(canonical).toLocaleLowerCase("en-US") === "bdmv") return canonical;
  const children = await readdir(canonical, { withFileTypes: true });
  const candidate = selectBdmvChild(children.map((entry) => ({
    name: entry.name,
    kind: entry.isSymbolicLink() ? "symlink" : entry.isDirectory() ? "directory" : "other",
  })), inputPath);
  return await realpath(resolve(canonical, candidate));
}

export async function discoverBdmvInput(inputPath: string): Promise<{ root: string; table: InputFileTable }> {
  const root = await locateBdmvRoot(inputPath);
  const paths: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isSymbolicLink()) throw new ContractError("SYMLINK_REJECTED", path, "Symlinks are not accepted in a BDMV input tree");
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) paths.push(relative(root, path).split(sep).join("/"));
    }
  };
  await walk(root);
  return { root, table: await buildInputFileTable(root, paths.sort((a, b) => a.localeCompare(b, "en"))) };
}

export async function readRegisteredFile(table: InputFileTable, relativePath: string, maxBytes: number, prefixOnly = false): Promise<{ bytes: Uint8Array; byteLength: number }> {
  const path = resolveFileReference(table, relativePath);
  const byteLength = await checkedFileSize(path, Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new ContractError("INVALID_LIMIT", "/maxBytes", "Read bound must be a positive safe integer");
  if (!prefixOnly && byteLength > maxBytes) throw new ContractError("LIMIT_EXCEEDED", relativePath, `File exceeds configured bounded read limit ${maxBytes}`);
  if (prefixOnly) {
    const handle = await open(path, "r");
    try { const buffer = Buffer.alloc(Math.min(byteLength, maxBytes)); const result = await handle.read(buffer, 0, buffer.length, 0); return { bytes: new Uint8Array(buffer.subarray(0, result.bytesRead)), byteLength }; }
    finally { await handle.close(); }
  }
  return { bytes: new Uint8Array(await readFile(path)), byteLength };
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

export function assertByteLimit(value: number | bigint, maxBytes: number, path = "/byteLength"): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new ContractError("INVALID_LIMIT", "/maxBytes", "Limit must be a positive safe integer");
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) throw new ContractError("INVALID_LENGTH", path, "Byte length must be a non-negative safe integer");
  if (typeof value === "bigint" && value < 0n) throw new ContractError("INVALID_LENGTH", path, "Byte length must be non-negative");
  if (BigInt(value) > BigInt(maxBytes)) throw new ContractError("LIMIT_EXCEEDED", path, `Value exceeds ${maxBytes} byte limit`);
}

export interface OutputTransaction { readonly stagingPath: string; commit(): Promise<void>; abort(): Promise<void> }

export async function beginOutputTransaction(targetPath: string, options: { overwrite?: boolean } = {}): Promise<OutputTransaction> {
  const target = resolve(targetPath);
  const parent = await realpath(dirname(target));
  const canonicalTarget = resolve(parent, basename(target));
  let originalTarget: Awaited<ReturnType<typeof lstat>> | null = null;
  try {
    originalTarget = await lstat(canonicalTarget);
    if (!options.overwrite) throw new ContractError("TARGET_EXISTS", targetPath, "Output target already exists");
    if (!originalTarget.isDirectory() || originalTarget.isSymbolicLink()) throw new ContractError("TARGET_NOT_DIRECTORY", targetPath, "Overwrite target must be a directory, not a file or symlink");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const stageBase = await mkdtemp(resolve(parent, `.${basename(target)}.staging-`));
  let closed = false;
  return {
    stagingPath: stageBase,
    async commit() {
      if (closed) throw new ContractError("TRANSACTION_CLOSED", targetPath, "Transaction is already closed");
      try {
        let currentTarget: Awaited<ReturnType<typeof lstat>> | null = null;
        try { currentTarget = await lstat(canonicalTarget); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (!originalTarget) {
          if (currentTarget) throw new ContractError("TARGET_EXISTS", targetPath, "Output target appeared while the transaction was running");
          await rename(stageBase, canonicalTarget);
        } else {
          if (!currentTarget || currentTarget.dev !== originalTarget.dev || currentTarget.ino !== originalTarget.ino) throw new ContractError("TARGET_CHANGED", targetPath, "Overwrite target changed while the transaction was running");
          const backupPath = resolve(parent, `.${basename(target)}.backup-${randomUUID()}`);
          await rename(canonicalTarget, backupPath);
          try { await rename(stageBase, canonicalTarget); }
          catch (error) {
            await rename(backupPath, canonicalTarget).catch(() => undefined);
            throw error;
          }
          await rm(backupPath, { recursive: true, force: true }).catch(() => undefined);
        }
        closed = true;
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
