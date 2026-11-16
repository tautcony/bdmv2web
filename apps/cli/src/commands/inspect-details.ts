import { disassemble } from "@bdmv2web/hdmv";
import type { Playlist } from "@bdmv2web/bdmv-parser";
import type { InspectionCollection } from "./inspect-collection.js";
import type { BrowserRow, InspectionBrowserModel } from "./inspect-browser-model.js";
import { format45kTime, projectInspectReport } from "./inspect-report.js";

export interface InspectionDetailLine { kind: "heading" | "field" | "source"; text: string; }
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue { return value !== null && typeof value === "object" ? value as RecordValue : {}; }
function records(value: unknown): RecordValue[] { return Array.isArray(value) ? value.map(record) : []; }
function label(key: string): string { const text = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " "); return text.charAt(0).toUpperCase() + text.slice(1); }
function display(value: unknown): string {
  if (value === undefined || value === null) return "unknown";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return String(value);
  if (value instanceof Uint8Array) return `${value.byteLength} bytes`;
  if (value instanceof Map) return `${value.size} entries`;
  if (Array.isArray(value)) return `${value.length} records`;
  return `${Object.keys(record(value)).length} fields`;
}
function hex(value: unknown): string { return typeof value === "number" ? "0x" + value.toString(16).toUpperCase() : "unknown"; }
function time(value: unknown): string { return typeof value === "number" || typeof value === "bigint" ? format45kTime(value) : "unknown"; }
function source(value: unknown): string {
  if (typeof value === "string") return value;
  const item = record(value);
  if (typeof item.path !== "string") return "unknown";
  const offset = item.stage === "structural" ? item.sourceOffset : item.segmentFileOffset ?? item.offset;
  return `${item.path}${offset == null ? "" : " @ " + display(offset)}${item.origin ? " (" + display(item.origin) + ")" : ""}`;
}

/** Domain summaries keep navigation and asset facts readable beside the table. */
export function buildInspectionDetails(row: BrowserRow, data: InspectionCollection, model: InspectionBrowserModel): InspectionDetailLine[] {
  const lines: InspectionDetailLine[] = [];
  const heading = (text: string) => { lines.push({ kind: "heading", text }); };
  const field = (name: string, value: unknown) => { lines.push({ kind: "field", text: `${name}: ${display(value)}` }); };
  const item = record(row.value);
  const list = (name: string, values: unknown[]) => { field(name, values.length ? values.map(display).join(", ") : "none"); };
  const generic = (value: unknown, prefix = "") => {
    for (const [key, entry] of Object.entries(record(value))) {
      if (key === "source") continue;
      const name = prefix ? `${prefix} / ${label(key)}` : label(key);
      if (Array.isArray(entry)) {
        if (!entry.length) field(name, "none");
        else if (entry.every((child: unknown) => child === null || typeof child !== "object")) list(name, entry as unknown[]);
        else { heading(`${name} (${entry.length})`); entry.forEach((child: unknown, index: number) => generic(child, String(index))); }
      } else if (entry instanceof Map) {
        heading(`${name} (${entry.size})`);
        for (const [entryKey, child] of entry as Map<unknown, unknown>) {
          if (child !== null && typeof child === "object") generic(child, display(entryKey));
          else field(display(entryKey), child);
        }
      } else if (entry !== null && typeof entry === "object" && !(entry instanceof Uint8Array)) generic(entry, name);
      else field(name, entry);
    }
  };
  const streams = (name: string, values: RecordValue[]) => {
    heading(`${name} (${values.length})`);
    if (!values.length) field("Streams", "none");
    for (const stream of values) {
      field(`${display(stream.category ?? "PID")} ${hex(stream.pid)}`, `coding ${hex(stream.codingType)} · language ${display(stream.language)}`);
      if (stream.source) field("  Declared at", source(stream.source));
      if (stream.videoAttributes) generic(stream.videoAttributes, "  Video");
    }
  };
  heading(row.label);

  if (typeof item.kind === "string" && ["firstPlay", "topMenu", "title"].includes(item.kind) && item.target) {
    const target = record(item.target);
    heading("Navigation entry");
    field("Entry", item.id);
    field("Kind", item.kind);
    field("Target", `${target.objectType === "HDMV" ? "MovieObject" : "BDJO"} ${display(target.target)}`);
    field("Playback type", target.playbackType);
    field("Access type", target.accessType);
    const program = typeof target.target === "number" ? model.targets.get("object:" + target.target) : undefined;
    if (program) {
      field("Commands", program.children?.length ?? 0);
      const playlists = new Set(program.children?.flatMap((command) => [command, ...(command.children ?? [])]).map((edge) => edge.navigateTo).filter((id): id is string => id?.startsWith("playlist:") === true));
      list("Direct static MPLS targets", [...playlists].map((id) => id.slice("playlist:".length)));
    }
    field("Open", row.navigateTo || program ? "Enter follows the declared target" : "target unresolved");
  } else if (Array.isArray(item.playItems) && Array.isArray(item.marks)) {
    const playlist = row.value as Playlist;
    const projected = projectInspectReport({ ...data.disc, playlists: [playlist] }).playlists[0]!;
    heading("Playlist");
    field("MPLS", playlist.id);
    field("Duration", format45kTime(projected.duration45k));
    field("PlayItems", playlist.playItems.length);
    field("Marks", playlist.marks.length);
    field("SubPaths", playlist.subPaths.length);
    list("Referenced clips", [...new Set(playlist.playItems.map((playItem) => playItem.clipId))]);
    if (playlist.appInfo) { heading("Playback properties"); generic(playlist.appInfo); }
    if (projected.marks.length) {
      heading("Marks / playlist timeline");
      for (const { mark, chapterTime45k } of projected.marks) field(`Mark ${mark.index}`, `PlayItem ${mark.playItemRef} · ${format45kTime(chapterTime45k)} · type ${mark.type}`);
    }
    field("Open", "Enter lists PlayItems in declared index order");
  } else if (typeof item.clipId === "string" && "inTime45k" in item) {
    heading("PlayItem interval");
    field("Index", item.index);
    field("Clip", `${item.clipId}.${display(item.codecId)}`);
    field("IN", time(item.inTime45k)); field("OUT", time(item.outTime45k));
    field("Duration", typeof item.inTime45k === "number" && typeof item.outTime45k === "number" ? format45kTime(item.outTime45k - item.inTime45k) : "unknown");
    field("STC", item.stcId); field("Angles", item.angleCount); field("Multi-angle", item.multiAngle); field("Seamless angle", item.seamlessAngle);
    streams("MPLS stream declarations", records(item.streams));
    if (records(item.angles).length) { heading("Angle clips"); for (const angle of records(item.angles)) field(`Angle ${display(angle.index)}`, `${display(angle.clipId)} · STC ${display(angle.stcId)}`); }
  } else if ("fileSize" in item && "reversePlayItems" in item) {
    const node = record(item.fileNode);
    const clip = record(item.clip);
    heading("Source file");
    field("Path", node.state === "present" ? source(node.source) : "unavailable");
    field("CLPI", clip.source ? source(clip.source) : "missing");
    field("File state", node.state); field("File size", typeof item.fileSize === "number" ? `${item.fileSize} bytes` : "unknown");
    field("Graphics scan", item.scanStatus);
    if (item.scanStatus === "structure-only") field("Coverage", "MPLS/CLPI declarations collected; payload measurements unavailable");
    if (Array.isArray(item.relatedIgsClips) && item.relatedIgsClips.length) list("IGS clips via SubPath", item.relatedIgsClips as unknown[]);
    heading("Graphics assets"); field("IGS scenes", item.scanStatus === "scanned" || item.scanStatus === "partial" ? records(item.scenes).length : "unknown"); field("Reachable SUP declarations", records(item.reachableSup).length);
    heading("Measured transport payload");
    const payloads = item.payloadBytes;
    if (payloads instanceof Map && payloads.size) for (const [pid, bytes] of payloads as Map<number, number>) field(`PID ${hex(pid)}`, `${bytes} bytes`);
    else field("Payload measurements", "unavailable");
    streams("CLPI stream declarations", records(clip.programs).flatMap((program) => records(program.streams)));
    heading("Playlist references");
    for (const reference of records(item.reversePlayItems)) field(`MPLS ${display(reference.playlist)}`, `PlayItem ${display(reference.playItemIndex)} · ${source(reference.source)}`);
    for (const reference of records(item.reverseSubPaths)) field(`MPLS ${display(reference.playlist)}`, `SubPath ${display(reference.subPathIndex)} · ${source(reference.source)}`);
  } else if (typeof item.compositionNumber === "number" && Array.isArray(item.pages)) {
    heading("IGS composition");
    field("Clip / PID", `${display(item.clipId)} / ${hex(item.pid)}`); field("Composition", item.compositionNumber);
    field("Canvas", `${display(item.width)} × ${display(item.height)}`); field("Complete", item.complete);
    field("PTS (90 kHz)", item.pts90k); field("Stream model", item.streamModel); field("UI model", item.uiModel);
    field("Image elements", records(item.objects).length); field("Palettes", records(item.palettes).length);
    heading("Menu pages");
    for (const page of records(item.pages)) {
      field(`Page ${display(page.id)}`, `${records(page.buttons).length} buttons · palette ${display(page.paletteId)}`);
      field("  Default selected / activated", `${display(page.defaultSelectedButtonId)} / ${display(page.defaultActivatedButtonId)}`);
      for (const button of records(page.buttons)) field(`  Button ${display(button.id)}`, `position ${display(button.x)}, ${display(button.y)} · ${records(button.commands).length} commands`);
    }
  } else if (item.indices instanceof Uint8Array && "width" in item) {
    heading("Image element"); field("Object ID", item.id); field("Version", item.version);
    field("Dimensions", `${display(item.width)} × ${display(item.height)}`); field("Indexed pixels", item.indices.byteLength);
  } else if (typeof item.playlistId === "string" && typeof item.pid === "number") {
    heading("Reachable SUP declaration"); field("Clip", item.clipId); field("PID", hex(item.pid)); field("Language", item.language);
    field("Stream number", item.streamNumber); field("MPLS / PlayItem", `${item.playlistId} / ${display(item.playItemIndex)}`);
    const bytes = data.graphics?.payloadBytesByClip?.get(String(item.clipId))?.get(item.pid);
    field("Measured PID payload", bytes === undefined ? "unknown" : `${bytes} bytes`);
  } else if (typeof item.bytes === "string") {
    heading("HDMV command");
    if (typeof item.programLabel === "string") field("Program", item.programLabel);
    if (typeof item.instruction === "string") field("Instruction", item.instruction);
    else { try { field("Instruction", disassemble(item.bytes)); } catch { field("Instruction", "decode unavailable"); } }
    field("Raw bytes", item.bytes);
    heading("Static outgoing references");
    const edges = Array.isArray(item.edges)
      ? records(item.edges)
      : (row.children ?? []).map((edge) => record(edge.value));
    if (!edges.length) field("References", "none");
    for (const value of edges) field(display(value.kind), `${display(value.to)} · ${display(value.condition ?? value.resolution)}`);
    if (row.navigateTo) field("Open", "Enter opens " + row.navigateTo);
  } else if (Array.isArray(item.commands) && typeof item.label === "string") {
    heading("Command program"); field("Program", item.label); field("Commands", item.commands.length);
    const objectId = row.label.match(/^MovieObject (\d+)$/)?.[1];
    const object = objectId === undefined ? undefined : data.disc.movieObjects.find((candidate) => candidate.id === Number(objectId));
    if (object) { field("Resume intention", object.resumeIntention); field("Menu call mask", object.menuCallMask); field("Title search mask", object.titleSearchMask); }
    field("Open", "Enter lists commands; select a command to inspect its targets");
  } else if (typeof item.from === "string" || item.edge) {
    const edge = item.edge ? record(item.edge) : item;
    heading("Static navigation reference"); field("From", edge.from); field("Kind", edge.kind); field("Target", edge.to);
    field("Condition", edge.condition ?? "none"); field("Resolution", edge.resolution);
    field("Target data", row.navigateTo && model.targets.has(row.navigateTo) ? "available · Enter opens target" : "unavailable / unresolved");
  } else if (typeof item.message === "string" && typeof item.code === "string") {
    heading("Diagnostic"); field("Severity", item.severity); field("Code", item.code); field("Message", item.message);
    if (item.details) { heading("Context"); generic(item.details); }
  } else if (Array.isArray(item.programs)) {
    heading("CLPI"); field("Clip", item.id); field("Version", item.version); field("Programs", item.programs.length);
    streams("Stream declarations", records(item.programs).flatMap((program) => records(program.streams)));
    field("Clip marks", records(item.clipMarks).length);
    for (const [key, value] of Object.entries(item)) if (!["source", "programs", "id", "version"].includes(key)) field(label(key), value);
  } else {
    heading("Properties");
    if (row.value !== null && typeof row.value === "object") generic(row.value);
    else field("Value", row.value);
  }
  if (row.source) { heading("Source"); lines.push({ kind: "source", text: row.source }); }
  return lines;
}
