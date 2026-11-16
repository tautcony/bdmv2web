import type { ParseDiagnostic } from "@bdmv2web/bdmv-parser";
import type { IgsDiagnostic } from "@bdmv2web/igs";

export function renderListDiagnostics(diagnostics: ParseDiagnostic[], extractionDiagnostics: IgsDiagnostic[]): string[] {
  const lines = [`Diagnostics (${diagnostics.length + extractionDiagnostics.length}):`];
  if (diagnostics.length === 0 && extractionDiagnostics.length === 0) return [...lines, "  none"];
  for (const diagnostic of diagnostics) {
    lines.push(`  ${diagnostic.severity} ${diagnostic.code} — ${diagnostic.message}`);
    lines.push(`    source ${diagnostic.sourcePath ?? "unknown"}${diagnostic.offset === null ? "" : ` @ ${diagnostic.offset}`}`);
  }
  for (const diagnostic of extractionDiagnostics) {
    const source = diagnostic.source;
    const path = source?.path ?? "unknown";
    const offset = source?.stage === "structural" ? source.sourceOffset : source?.segmentFileOffset;
    const packet = source?.stage === "transport" ? `, packet ${source.packetOffset}` : "";
    lines.push(`  ${diagnostic.severity} ${diagnostic.code} — ${diagnostic.message}`);
    lines.push(`    source ${path}${offset === null || offset === undefined ? "" : ` @ ${offset}`}${packet}`);
  }
  return lines;
}
