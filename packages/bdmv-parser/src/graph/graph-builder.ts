import type { BdjoInfo, ClipInfo, GraphEdge, GraphNode, MovieObject, ParseDiagnostic, ParsedDisc, Playlist, SoundEntry } from "../model.js";
import { bdmvRelativePath } from "@bdmv2web/core/disc-path";
import { sourceFor, type FileEntry } from "../parsing/source-location.js";

function normCase(value: string): string { return value.toLocaleLowerCase("en-US"); }
type Report = (diagnostics: ParseDiagnostic[], code: string, message: string, file?: FileEntry, offset?: number, severity?: ParseDiagnostic["severity"], recoverable?: boolean, entityId?: string | null) => void;

export function buildDiscGraph(entries: ParsedDisc["entries"], objects: MovieObject[], playlists: Playlist[], clips: ClipInfo[], sounds: SoundEntry[], files: FileEntry[], diagnostics: ParseDiagnostic[], diagnose: Report, bdjos: BdjoInfo[] = [], metadata: NonNullable<ParsedDisc["metadata"]> = []): ParsedDisc["graph"] {
  const nodes: GraphNode[] = []; const edges: GraphEdge[] = []; const seen = new Set<string>();
  const add = (node: GraphNode) => { if (seen.has(node.id)) return; seen.add(node.id); nodes.push(node); };
  const fileByPath = new Map(files.map((file) => [normCase(file.rel), file]));
  // The reference lookups below resolve once per node instead of rescanning the
  // arrays; the first match wins, as the linear searches did.
  const objectById = new Map<number, MovieObject>();
  for (const object of objects) if (!objectById.has(object.id)) objectById.set(object.id, object);
  const clipByKey = new Map<string, ClipInfo>();
  for (const clip of clips) { const key = normCase(clip.id); if (!clipByKey.has(key)) clipByKey.set(key, clip); }
  const fileByRelativePath = new Map<string, FileEntry>();
  for (const file of files) { const key = bdmvRelativePath(file.rel); if (!fileByRelativePath.has(key)) fileByRelativePath.set(key, file); }
  const bdjoByPath = new Map(bdjos.map((bdjo) => [normCase(bdjo.path.replace(/^BACKUP\//i, "")), bdjo]));
  const pathSource = (file: FileEntry) => sourceFor(file, "primary", 0);
  for (const entry of entries) {
    const id = `entry:${entry.id}`;
    add({ id, type: entry.kind === "title" ? "title" : "entry", state: "present", source: entry.source });
    if (entry.target.objectType === "HDMV" && typeof entry.target.target === "number") {
      const targetId = `movieObject:${entry.target.target}`; const object = objectById.get(entry.target.target);
      edges.push({ from: id, to: targetId, kind: "entry-target", resolution: object ? "resolved" : "missing", source: entry.source });
      if (!object) add({ id: targetId, type: "movieObject", state: "missing", source: entry.source });
    } else if (entry.target.objectType === "BDJ" && typeof entry.target.target === "string") {
      const targetId = `bdjo:${entry.target.target}`; const bdjoFile = fileByPath.get(normCase(`BDMV/BDJO/${entry.target.target}.bdjo`));
      const parsedBdjo = bdjoByPath.get(normCase(`BDJO/${entry.target.target}.bdjo`));
      add({ id: targetId, type: "bdjo", state: bdjoFile ? "present" : "missing", source: parsedBdjo?.source ?? (bdjoFile ? pathSource(bdjoFile) : entry.source) });
      edges.push({ from: id, to: targetId, kind: "bdj-target", resolution: bdjoFile ? "resolved" : "missing", source: entry.source });
      if (!bdjoFile) diagnose(diagnostics, "BDMV_MISSING_BDJO", `BD-J entry ${entry.id} references missing BDJO ${entry.target.target}`, fileByRelativePath.get(entry.source.path), Number(entry.source.offset), "error", true, id);
    }
  }
  for (const manifest of metadata) add({ id: `metaDl:${manifest.language}`, type: "metaDl", state: "present", source: manifest.source });
  for (const object of objects) {
    const id = `movieObject:${object.id}`; add({ id, type: "movieObject", state: "present", source: object.source });
    for (const [index, instruction] of object.instructions.entries()) edges.push({ from: id, to: `command:${object.id}:${index}`, kind: "raw-command", resolution: "unresolved", source: instruction.source });
  }
  for (const playlist of playlists) {
    const playlistId = `playlist:${playlist.id}`; add({ id: playlistId, type: "playlist", state: "present", source: playlist.source });
    for (const item of playlist.playItems) {
      const itemId = `playItem:${playlist.id}:${item.index}`; add({ id: itemId, type: "playItem", state: "present", source: item.source });
      edges.push({ from: playlistId, to: itemId, kind: "contains", resolution: "resolved", source: item.source });
      const clipId = `clip:${item.clipId}`; const streamFile = fileByPath.get(normCase(`BDMV/STREAM/${item.clipId}.m2ts`));
      add({ id: clipId, type: "clip", state: streamFile ? "present" : "missing", source: streamFile ? pathSource(streamFile) : item.source });
      edges.push({ from: itemId, to: clipId, kind: "clip-reference", resolution: streamFile ? "resolved" : "missing", source: item.source });
      const infoId = `clipInfo:${item.clipId}`; const info = clipByKey.get(normCase(item.clipId));
      add({ id: infoId, type: "clipInfo", state: info ? "present" : "missing", source: info?.source ?? item.source });
      edges.push({ from: itemId, to: infoId, kind: "clip-info-reference", resolution: info ? "resolved" : "missing", source: item.source });
      if (!streamFile) diagnose(diagnostics, "BDMV_MISSING_STREAM", `PlayItem ${playlist.id}/${item.index} references missing STREAM clip ${item.clipId}`, fileByRelativePath.get(item.source.path), Number(item.source.offset), "error", true, itemId);
      if (!info) diagnose(diagnostics, "BDMV_MISSING_CLPI", `PlayItem ${playlist.id}/${item.index} references missing CLPI ${item.clipId}`, fileByRelativePath.get(item.source.path), Number(item.source.offset), "error", true, itemId);
      if (info) {
        const declared = new Map(info.programs.flatMap((program) => program.streams.map((stream) => [stream.pid, stream] as const)));
        for (const stream of item.streams) {
          // Stream type 2 carries a SubPath/SubClip selector. Its PID belongs to
          // that secondary clip, so comparing it with this PlayItem's CLPI is false.
          if (stream.streamType !== 1) continue;
          if (stream.pid === null) continue;
          const clipStream = declared.get(stream.pid);
          if (!clipStream) diagnose(diagnostics, "BDMV_STN_CLPI_PID_CONFLICT", `STN PID ${stream.pid} is not declared by CLPI ${info.id}`, fileByRelativePath.get(stream.source.path), Number(stream.source.offset), "warning", true, itemId);
          else if (stream.codingType !== null && stream.codingType !== clipStream.codingType) diagnose(diagnostics, "BDMV_STN_CLPI_CODING_CONFLICT", `STN and CLPI coding types differ for PID ${stream.pid}`, fileByRelativePath.get(stream.source.path), Number(stream.source.offset), "warning", true, itemId);
        }
      }
    }
    for (const [subPathIndex, subPath] of playlist.subPaths.entries()) {
      const subPathId = `subPath:${playlist.id}:${subPathIndex}`;
      add({ id: subPathId, type: "subPath", state: "present", source: subPath.source });
      edges.push({ from: playlistId, to: subPathId, kind: "contains-subpath", resolution: "resolved", source: subPath.source });
      for (const [subItemIndex, subItem] of subPath.items.entries()) {
        const clipId = `clip:${subItem.clipId}`;
        const streamFile = fileByPath.get(normCase(`BDMV/STREAM/${subItem.clipId}.m2ts`));
        add({ id: clipId, type: "clip", state: streamFile ? "present" : "missing", source: streamFile ? pathSource(streamFile) : subItem.source });
        edges.push({ from: subPathId, to: clipId, kind: "subpath-clip-reference", resolution: streamFile ? "resolved" : "missing", source: subItem.source });
        const infoId = `clipInfo:${subItem.clipId}`;
        const info = clipByKey.get(normCase(subItem.clipId));
        add({ id: infoId, type: "clipInfo", state: info ? "present" : "missing", source: info?.source ?? subItem.source });
        edges.push({ from: subPathId, to: infoId, kind: "subpath-clip-info-reference", resolution: info ? "resolved" : "missing", source: subItem.source });
        if (!streamFile) diagnose(diagnostics, "BDMV_MISSING_STREAM", `SubPlayItem ${playlist.id}/${subPathIndex}/${subItemIndex} references missing STREAM clip ${subItem.clipId}`, fileByRelativePath.get(subItem.source.path), Number(subItem.source.offset), "error", true, subPathId);
        if (!info) diagnose(diagnostics, "BDMV_MISSING_CLPI", `SubPlayItem ${playlist.id}/${subPathIndex}/${subItemIndex} references missing CLPI ${subItem.clipId}`, fileByRelativePath.get(subItem.source.path), Number(subItem.source.offset), "error", true, subPathId);
      }
    }
    for (const mark of playlist.marks) {
      const item = playlist.playItems[mark.playItemRef];
      if (!item || mark.time45k < item.inTime45k || mark.time45k > item.outTime45k) diagnose(diagnostics, "BDMV_INVALID_REFERENCE", `PlayMark ${mark.index} points outside a valid PlayItem interval`, fileByRelativePath.get(mark.source.path), Number(mark.source.offset), "error", true, playlistId);
    }
  }
  for (const clip of clips) for (const program of clip.programs) for (const stream of program.streams) add({ id: `stream:${clip.id}:${stream.pid}`, type: "stream", state: "present", source: stream.source });
  for (const sound of sounds) add({ id: `sound:${sound.index}`, type: "sound", state: "present", source: sound.source });
  return { nodes, edges };
}
