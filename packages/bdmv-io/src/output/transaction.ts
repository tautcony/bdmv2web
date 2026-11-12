import { errorText } from "@bdmv2web/utils";
import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { ContractError } from "@bdmv2web/core";

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
            try { await rename(backupPath, canonicalTarget); }
            catch (restoreError) {
              throw new ContractError("OUTPUT_RESTORE_FAILED", targetPath, `Staging commit failed (${errorText(error)}) and the previous output stays at ${backupPath}: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
            }
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
