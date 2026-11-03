import { ContractError } from "@bdmv-web/core";

export interface BdmvChildEntry {
  name: string;
  kind: "directory" | "symlink" | "other";
}

export function selectBdmvChild(entries: readonly BdmvChildEntry[], inputPath: string): string {
  const candidates = entries.filter((entry) => entry.name.toLocaleLowerCase("en-US") === "bdmv");
  if (candidates.some((entry) => entry.kind === "symlink")) {
    throw new ContractError("SYMLINK_REJECTED", inputPath, "BDMV root symlinks are not accepted");
  }
  const directories = candidates.filter((entry) => entry.kind === "directory");
  if (directories.length === 0) {
    throw new ContractError("BDMV_ROOT_NOT_FOUND", inputPath, "Input must be a BDMV root or its direct parent");
  }
  if (directories.length > 1) {
    throw new ContractError("BDMV_ROOT_AMBIGUOUS", inputPath, "More than one case-variant BDMV root was found");
  }
  return directories[0]!.name;
}
