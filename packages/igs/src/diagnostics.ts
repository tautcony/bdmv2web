import type { IgsDiagnostic } from "./scene/types.js";

/**
 * Identity of one reported event.
 *
 * One damaged packet can be reported by several assemblers over a clip, so the
 * copies of one event collapse onto one key. Severity, code, message and the
 * full source take part: a `TS_CONTINUITY_ERROR` with the same wording at a
 * different packet offset is a different event and keeps its own row.
 * `affectedSceneIds` stays out of the identity — it records which scene an
 * assembler could attribute the event to, and transport-layer assemblers have
 * nothing to attribute. JSON escaping keeps every field value unambiguous at
 * the tens of thousands of events a damaged clip can produce.
 */
export function diagnosticKey(diagnostic: IgsDiagnostic): string {
  const source = diagnostic.source;
  const identity = source
    ? [
        source.clipId, source.pid, source.path, source.origin,
        source.packetOffset, source.pesOffset, source.segmentOffset, source.segmentFileOffset,
        "sourceOffset" in source ? source.sourceOffset : null,
        source.pts90k, source.timeDomain, source.stage,
      ]
    : null;
  return JSON.stringify([diagnostic.severity, diagnostic.code, diagnostic.message, identity]);
}

/**
 * Collapse diagnostics that describe the same event, keeping the first sighting
 * and the order it appeared in.
 *
 * A stage merges the reports of its shared packet scan, PSI assembler, PES
 * assembler and IGS state, so one damaged section can be attributed more than
 * once and the merged list holds one row per event. Scene references are
 * unioned, and a retained diagnostic is copied when that union changes it, so
 * callers' arrays stay untouched. A duplicate without scene references leaves
 * the first sighting as it is.
 */
export function uniqueDiagnostics(diagnostics: readonly IgsDiagnostic[]): IgsDiagnostic[] {
  const byKey = new Map<string, IgsDiagnostic>();
  for (const diagnostic of diagnostics) {
    const key = diagnosticKey(diagnostic);
    const seen = byKey.get(key);
    if (!seen) { byKey.set(key, diagnostic); continue; }
    if (diagnostic.affectedSceneIds.length === 0) continue;
    const merged = [...new Set([...seen.affectedSceneIds, ...diagnostic.affectedSceneIds])];
    if (merged.length !== seen.affectedSceneIds.length) byKey.set(key, { ...seen, affectedSceneIds: merged });
  }
  return [...byKey.values()];
}
