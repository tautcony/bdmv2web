import { ContractError, DEFAULT_LIMITS, type Limits } from "@bdmv-web/core";
import { discoverBdmvInput, readFileChunks, resolveFileReference, type InputFileTable } from "@bdmv-web/bdmv-io";
import type { ClipInfo, ParsedDisc, SourceLocation, StreamDeclaration } from "@bdmv-web/bdmv-parser";
import type { IgsDiagnostic, IgsExtraction, IgsOptions, IgsScene, PtsValue, TsPacket } from "./types.js";
import { consumeSegment, createIgsState, parseSegments } from "./igs.js";
import { renderSceneAssets } from "./png.js";
import { M2tsPacketReader, PesAssembler, PsiAssembler, source, type PesPacket } from "./transport.js";

export async function extractIgsScenes(disc: ParsedDisc, options: IgsOptions & { table?: InputFileTable } = {}): Promise<IgsExtraction> {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const table = options.table ?? (await discoverBdmvInput(disc.root)).table;
  const diagnostics: IgsDiagnostic[] = [];
  const scenes: IgsScene[] = [];
  const assets: IgsExtraction["assets"] = [];
  const seen = new Set<string>();
  for (const playlist of disc.playlists) {
    for (const item of playlist.playItems) {
      const primaryMplsStreams = item.streams.filter((stream) => isIgStream(stream) && stream.streamType === 1);
      const targets: Array<{ clipId: string; mplsStreams: StreamDeclaration[] }> = [];
      // CLPI can provide the cue when MPLS does not, but do not probe an unrelated
      // primary clip just because another stream type points to subpath content.
      const primaryClipInfo = disc.clips.find((clip) => sameId(clip.id, item.clipId));
      const primaryHasClpiIg = primaryClipInfo?.programs.some((program) => program.streams.some((stream) => stream.codingType === 0x91)) ?? false;
      if (primaryMplsStreams.length || primaryHasClpiIg) targets.push({ clipId: item.clipId, mplsStreams: primaryMplsStreams });
      for (const stream of item.streams) {
        if (!isIgStream(stream) || stream.streamType !== 2) continue;
        const subPath = stream.subPathId === null ? undefined : playlist.subPaths[stream.subPathId];
        const subClip = stream.subClipId === null ? undefined : subPath?.items[stream.subClipId];
        if (!subClip) {
          diagnostics.push({ severity: "error", code: "BDMV_MISSING_STREAM", message: `Clip ${item.clipId} has an IGS stream reference to missing subpath ${stream.subPathId ?? "?"} subclip ${stream.subClipId ?? "?"}`, source: toIgsSource(stream.source), affectedSceneIds: [] });
          continue;
        }
        const existing = targets.find((target) => sameId(target.clipId, subClip.clipId));
        if (existing) existing.mplsStreams.push(stream);
        else targets.push({ clipId: subClip.clipId, mplsStreams: [stream] });
      }

      for (const target of targets) {
        if (seen.has(target.clipId)) continue;
        seen.add(target.clipId);
        const clipInfo = disc.clips.find((clip) => sameId(clip.id, target.clipId));
        const streamNode = disc.graph.nodes.find((node) => node.id === `clip:${target.clipId}` && node.type === "clip");
        const streamPath = streamNode?.source?.path;
        if (streamNode?.state !== "present" || !streamPath || !isStreamPath(streamPath, target.clipId)) {
          diagnostics.push({ severity: "error", code: "BDMV_MISSING_STREAM", message: `Clip ${target.clipId} has no registered STREAM path in ParsedDisc`, source: toIgsSource(item.source), affectedSceneIds: [] });
          continue;
        }
        let path: string;
        try { path = resolveDiscFileReference(table, streamPath); }
        catch (e) {
          diagnostics.push({ severity: "error", code: "BDMV_MISSING_STREAM", message: e instanceof Error ? e.message : String(e), source: toIgsSource(item.source), affectedSceneIds: [] });
          continue;
        }
        const clpiStreams = clipInfo?.programs.flatMap((program) => program.streams.filter((stream) => stream.codingType === 0x91).map((stream) => ({ pid: stream.pid, source: stream.source }))) ?? [];
        const expected = [...target.mplsStreams, ...clpiStreams].filter((cue): cue is { pid: number; source: SourceLocation } => cue.pid !== null);
        const result = await extractClip(target.clipId, path, expected, { ...options, limits });
        diagnostics.push(...result.diagnostics);
        scenes.push(...result.scenes);
        assets.push(...result.assets);
      }
    }
  }
  const hasErrors = diagnostics.some((d) => d.severity === "error");
  const hasWarnings = diagnostics.some((d) => d.severity === "warning");
  return { scenes, assets, diagnostics, status: hasErrors ? (scenes.length ? "partial" : "failed") : (hasWarnings || !scenes.length ? "partial" : "complete"), support: { format: "Blu-ray IGS", status: "unverified" } };
}

export async function extractIgsFromChunks(clipId: string, chunks: AsyncIterable<Uint8Array>, expectedPidCues: Array<{ pid: number; source: SourceLocation }> = [], options: IgsOptions = {}): Promise<IgsExtraction> {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const reader = new M2tsPacketReader(clipId, limits);
  const psiDiagnostics: IgsDiagnostic[] = [];
  const psi = new PsiAssembler(psiDiagnostics, clipId);
  const pes = new PesAssembler(clipId, limits);
  const state = createIgsState(); const diagnostics: IgsDiagnostic[] = [];
  const candidatePids = new Set(expectedPidCues.map((x) => x.pid));
  const streamBytes = new Map<number, bigint>();
  const residuals = new Map<number, Uint8Array<ArrayBufferLike>>();
  const spans = new Map<number, Array<{ start: bigint; end: bigint; packetOffset: bigint; pesOffset: bigint; payloadOffset: bigint; pts: PtsValue | null }>>();
  const processPes = (unit: PesPacket): void => {
    const previousTotal = streamBytes.get(unit.pid) ?? 0n;
    const previousResidualLength = BigInt(residuals.get(unit.pid)?.length ?? 0);
    const segmentStart = previousTotal - previousResidualLength;
    const spanList = spans.get(unit.pid) ?? [];
    spanList.push({ start: previousTotal, end: previousTotal + BigInt(unit.payload.length), packetOffset: unit.packetOffset, pesOffset: unit.pesOffset, payloadOffset: unit.payloadOffset, pts: unit.pts });
    spans.set(unit.pid, spanList);
    const parsed = parseSegments(unit.payload, segmentStart, Uint8Array.from(residuals.get(unit.pid) ?? []), clipId, unit.pid, unit.pts);
    residuals.set(unit.pid, parsed.residual); streamBytes.set(unit.pid, previousTotal + BigInt(unit.payload.length));
    diagnostics.push(...parsed.diagnostics);
    for (const segment of parsed.segments) {
      const origin = spanList.find((span) => segment.offset >= span.start && segment.offset < span.end) ?? spanList[0];
      const fileOffset = (origin?.payloadOffset ?? unit.payloadOffset) + (segment.offset - (origin?.start ?? segment.offset));
      consumeSegment(state, segment, clipId, unit.pid, origin?.pts ?? unit.pts, origin?.packetOffset ?? unit.packetOffset, origin?.pesOffset ?? unit.pesOffset, fileOffset, limits);
    }
    const residualStart = previousTotal + BigInt(unit.payload.length) - BigInt(parsed.residual.length);
    spans.set(unit.pid, spanList.filter((span) => span.end > residualStart));
  };
  const processPacket = (packet: TsPacket): void => {
    const wasKnownIgPid = psi.streamsByPid.get(packet.pid) === 0x91;
    psi.push(packet);
    if (packet.continuityError || packet.transportError || packet.discontinuity) {
      if (candidatePids.has(packet.pid) || wasKnownIgPid) {
        residuals.delete(packet.pid); streamBytes.delete(packet.pid); spans.delete(packet.pid);
        const current = state.current.get(packet.pid);
        if (current) diagnostics.push({ severity: "error", code: "IGS_STREAM_INVALIDATED", message: `PID ${packet.pid} transport damage discarded the active Display Set`, source: current.source, affectedSceneIds: [`${current.source.clipId}:${current.source.pid}:${current.source.packetOffset}`] });
        state.current.delete(packet.pid);
        for (const key of [...state.pendingObjects.keys()]) if (key.startsWith(`${packet.pid}:`)) state.pendingObjects.delete(key);
        for (const key of [...state.objects.keys()]) if (key.startsWith(`${packet.pid}:`)) state.objects.delete(key);
        for (const key of [...state.palettes.keys()]) if (key.startsWith(`${packet.pid}:`)) state.palettes.delete(key);
      }
    }
    const pidType = psi.streamsByPid.get(packet.pid);
    if (pidType === 0x91 && expectedPidCues.length === 0) candidatePids.add(packet.pid);
    if (!candidatePids.has(packet.pid)) return;
    for (const unit of pes.push(packet)) processPes(unit);
  };
  for await (const chunk of chunks) for (const packet of reader.feed(chunk)) processPacket(packet);
  reader.end();
  pes.end();
  for (const [pid, residual] of residuals) if (residual.length) diagnostics.push({ severity: "error", code: "IGS_INVALID_SEGMENT", message: `PID ${pid} ended with ${residual.length} residual IG segment bytes`, source: source(clipId, pid, streamBytes.get(pid) ?? 0n), affectedSceneIds: [] });
  for (const current of state.current.values()) diagnostics.push({ severity: "error", code: "IGS_UNCOMPLETED_DISPLAY_SET", message: "EOF before END segment; Display Set was not committed", source: current.source, affectedSceneIds: [] });
  for (const pending of state.pendingObjects.values()) diagnostics.push({ severity: "error", code: "IGS_INVALID_SEGMENT", message: `EOF with incomplete ODS object ${pending.id} version ${pending.version}`, source: pending.source, affectedSceneIds: [] });
  const pmtIgsCues = [...psi.streamsByPid].filter(([, type]) => type === 0x91).map(([pid]) => ({ pid, source: psi.streamSourcesByPid.get(pid) ?? null }));
  const streamPids = pmtIgsCues.map((cue) => cue.pid);
  const cuePids = uniquePids(expectedPidCues);
  if ((expectedPidCues.length && (!streamPids.length || streamPids.some((pid) => !cuePids.includes(pid)) || cuePids.some((pid) => !streamPids.includes(pid)))) || (!expectedPidCues.length && streamPids.length > 0)) {
    const structuralEvidence = expectedPidCues.map((cue) => ({ pid: cue.pid, path: cue.source.path, origin: cue.source.origin, offset: cue.source.offset }));
    const pmtEvidence = pmtIgsCues.map((cue) => ({ streamPid: cue.pid, clipId: cue.source?.clipId ?? null, pmtPid: cue.source?.pid ?? null, packetOffset: cue.source?.packetOffset ?? null }));
    const structuralDescription = structuralEvidence.map((cue) => `${cue.pid} from ${cue.path} (${cue.origin}) @ ${cue.offset}`).join(", ");
    const pmtDescription = pmtEvidence.map((cue) => `${cue.streamPid} from clip ${cue.clipId ?? "?"} PMT PID ${cue.pmtPid ?? "?"} packet offset ${cue.packetOffset ?? "?"}`).join(", ");
    diagnostics.push({
      severity: "error", code: "IGS_PID_CONFLICT",
      message: `MPLS/CLPI IG PID cue(s) [${structuralDescription || cuePids.join(", ")}] disagree with PMT IG PID(s) [${pmtDescription || streamPids.join(", ")}]`,
      source: expectedPidCues[0] ? toIgsSource(expectedPidCues[0].source) : pmtIgsCues[0]?.source ?? null,
      affectedSceneIds: [],
      details: { mplsClpiPids: cuePids.join(","), pmtPids: streamPids.join(","), mplsClpiSources: JSON.stringify(structuralEvidence), pmtSources: JSON.stringify(pmtEvidence) },
    });
    for (const scene of state.scenes) diagnostics.push({ severity: "error", code: "IGS_PID_CONFLICT", message: `Scene ${scene.id} was discarded because its PID conflicts with structure cues`, source: scene.source, affectedSceneIds: [scene.id] });
    state.scenes.length = 0;
  }
  if (!expectedPidCues.length && !streamPids.length) diagnostics.push({ severity: "warning", code: "IGS_PID_UNRESOLVED", message: "No IG PID could be established from MPLS/CLPI/PMT", source: null, affectedSceneIds: [] });
  diagnostics.push(...reader.diagnostics, ...pes.diagnostics, ...psiDiagnostics);
  diagnostics.push(...state.diagnostics);
  const scenes = state.scenes;
  const assets = [] as IgsExtraction["assets"];
  for (const scene of scenes) { const result = renderSceneAssets(scene); assets.push(...result.assets); diagnostics.push(...result.diagnostics); }
  const errors = diagnostics.some((d) => d.severity === "error");
  const warnings = diagnostics.some((d) => d.severity === "warning");
  if (!scenes.length && !diagnostics.length) diagnostics.push({ severity: "warning", code: "IGS_NO_DISPLAY_SETS", message: "No complete IGS Display Set was found", source: null, affectedSceneIds: [] });
  return { scenes, assets, diagnostics, status: errors ? (scenes.length ? "partial" : "failed") : (warnings || !scenes.length ? "partial" : "complete"), support: { format: "Blu-ray IGS", status: "unverified" } };
}

async function extractClip(clipId: string, path: string, expected: Array<StreamDeclaration | { pid: number; source: SourceLocation }>, options: IgsOptions): Promise<IgsExtraction> {
  const chunks = readFileChunks(path, options.limits ?? DEFAULT_LIMITS, options.chunkSize ?? (options.limits ?? DEFAULT_LIMITS).maxReadWindowBytes);
  return extractIgsFromChunks(clipId, chunks, expected.flatMap((cue) => cue.pid === null ? [] : [{ pid: cue.pid, source: cue.source }]), options);
}

function isIgStream(stream: StreamDeclaration): boolean { return stream.codingType === 0x91 && stream.pid !== null; }
function isStreamPath(virtualPath: string, clipId: string): boolean {
  const withoutPrefix = virtualPath.replace(/^BDMV\//i, "");
  return new RegExp(`^STREAM/${escapeRegExp(clipId)}\\.m2ts$`, "i").test(withoutPrefix);
}
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function resolveDiscFileReference(table: InputFileTable, virtualPath: string): string {
  const withoutPrefix = virtualPath.replace(/^BDMV\//i, "");
  const candidates = [...new Set([virtualPath, withoutPrefix, `BDMV/${withoutPrefix}`])];
  for (const candidate of candidates) if (table.files.has(candidate)) return resolveFileReference(table, candidate);

  const keys = [...table.files.keys()];
  for (const candidate of candidates) {
    const matches = keys.filter((key) => key.toLocaleLowerCase("en-US") === candidate.toLocaleLowerCase("en-US"));
    if (matches.length === 1) return resolveFileReference(table, matches[0]!);
    if (matches.length > 1) throw new ContractError("FILE_REFERENCE_AMBIGUOUS", virtualPath, "Virtual BDMV path matches multiple validated input paths");
  }
  throw new ContractError("FILE_NOT_REGISTERED", virtualPath, "Virtual BDMV path is not present in the validated file table");
}
function uniquePids(cues: Array<{ pid: number | null; source: SourceLocation }> | Array<{ pid: number; source: SourceLocation }>): number[] { return [...new Set(cues.flatMap((cue) => cue.pid === null ? [] : [cue.pid]))]; }
function sameId(a: string, b: string): boolean { return a.toLocaleLowerCase("en-US") === b.toLocaleLowerCase("en-US"); }
function toIgsSource(sourceRef: SourceLocation) { return { clipId: "", pid: 0, packetOffset: sourceRef.offset, pesOffset: sourceRef.offset, segmentOffset: sourceRef.offset, segmentFileOffset: sourceRef.offset, pts90k: null, timeDomain: 0 }; }
