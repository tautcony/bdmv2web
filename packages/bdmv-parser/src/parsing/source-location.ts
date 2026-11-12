import { bdmvRelativePath } from "@bdmv2web/core/disc-path";
import type { SourceLocation } from "../model.js";

export interface FileEntry { rel: string; abs: string; size: number; }

export function sourceFor(file: Pick<FileEntry, "rel">, origin: "primary" | "backup", offset: number, normalizePath: (path: string) => string = bdmvRelativePath): SourceLocation {
  return { path: normalizePath(file.rel), origin, offset: String(offset) };
}
