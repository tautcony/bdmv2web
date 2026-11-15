import type { IgsDiagnostic } from "./scene/types.js";

/**
 * Identity of one reported event.
 *
 * Two readers that scanned the same bytes report the same packet damage, so the
 * copies of one event collapse onto one key. Everything a reader observed takes
 * part: severity, code, message and the full source (a second
 * `TS_CONTINUITY_ERROR` with the same wording at a different packet offset is a
 * different event and keeps its own row). `affectedSceneIds` stays out of the
 * identity — it records which scene a reader could attribute the event to, and
 * readers that stop at the transport layer have nothing to attribute.
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
 * `export` and `render` probe a stream and then extract its graphics from the
 * same bytes, so both passes report the same transport damage and the merged
 * list holds one row per event. Scene references are unioned rather than
 * dropped, and a retained diagnostic is copied when that union changes it, so
 * callers' arrays are never mutated.
 */
export function uniqueDiagnostics(diagnostics: readonly IgsDiagnostic[]): IgsDiagnostic[] {
  const byKey = new Map<string, IgsDiagnostic>();
  for (const diagnostic of diagnostics) {
    const key = diagnosticKey(diagnostic);
    const seen = byKey.get(key);
    if (!seen) { byKey.set(key, diagnostic); continue; }
    const merged = [...new Set([...seen.affectedSceneIds, ...diagnostic.affectedSceneIds])];
    if (merged.length !== seen.affectedSceneIds.length) byKey.set(key, { ...seen, affectedSceneIds: merged });
  }
  return [...byKey.values()];
}
