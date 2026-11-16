import { format45kTime } from "./inspect-report.js";
import type { InspectionCollection } from "./inspect-collection.js";
import { selectedClip, selectedPid } from "../cli/assets.js";
import { buildNavigationGraph, disassemble, type NavigationGraphEdge } from "@bdmv2web/hdmv";
import { buildButtonPrograms } from "../shared/media.js";

export type InspectionSection = "Navigation" | "MPLS" | "M2TS" | "Metadata" | "Diagnostics";
export interface BrowserRow {
  label: string;
  cells: string[];
  value: unknown;
  source?: string;
  children?: BrowserRow[];
  navigateTo?: string;
}
export interface InspectionBrowserModel {
  Navigation: BrowserRow[];
  MPLS: BrowserRow[];
  M2TS: BrowserRow[];
  Metadata: BrowserRow[];
  Diagnostics: BrowserRow[];
  targets: Map<string, BrowserRow>;
}
export const INSPECTION_SECTIONS: InspectionSection[] = ["Navigation", "MPLS", "M2TS", "Metadata", "Diagnostics"];

function sourceText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  const source = value as { path?: string; offset?: string; origin?: string; stage?: string; segmentFileOffset?: string; sourceOffset?: string };
  if (!source.path) return undefined;
  const offset = source.stage === "structural" ? source.sourceOffset : source.segmentFileOffset ?? source.offset;
  return source.path + " @ " + (offset ?? "unknown") + (source.origin ? " (" + source.origin + ")" : "");
}

function row(label: string, value: unknown, source?: string, cells: string[] = [label], children?: BrowserRow[], navigateTo?: string): BrowserRow {
  return { label, cells, value, ...(source === undefined ? {} : { source }), ...(children === undefined ? {} : { children }), ...(navigateTo === undefined ? {} : { navigateTo }) };
}

function normalizedCommands(program: { instructions: unknown[] }, fallbackPath: string): Array<{ bytes: string; source: { path: string; offset: string } }> {
  return program.instructions.map((instruction, index) => {
    if (typeof instruction === "string") return { bytes: instruction, source: { path: fallbackPath, offset: String(index) } };
    if (instruction instanceof Uint8Array) return { bytes: Buffer.from(instruction).toString("hex"), source: { path: fallbackPath, offset: String(index) } };
    if (!instruction || typeof instruction !== "object") return { bytes: String(instruction), source: { path: fallbackPath, offset: String(index) } };
    const command = instruction as { bytes?: string | Uint8Array; source?: { path?: string; offset?: string } };
    const bytes = command.bytes instanceof Uint8Array ? Buffer.from(command.bytes).toString("hex") : command.bytes ?? "";
    return { bytes, source: { path: command.source?.path ?? fallbackPath, offset: command.source?.offset ?? String(index) } };
  });
}

function m2tsRow(data: InspectionCollection, clipId: string): BrowserRow {
  const clip = data.disc.clips.find((item) => item.id.toUpperCase() === clipId.toUpperCase());
  const graphics = data.graphics;
  const scenes = data.assetType === "sup" ? [] : graphics?.scenes.filter((scene) => scene.clipId === clipId && selectedClip(scene.clipId, data.assetSelection) && selectedPid(scene.pid, data.assetSelection)) ?? [];
  const sup = data.assetType === "igs" ? [] : data.reachableSup.filter((item) => item.clipId === clipId);
  const children: BrowserRow[] = [
    ...(clip ? [row("CLPI " + clip.id, clip, sourceText(clip.source))] : []),
    ...scenes.map((scene) => row("IGS scene " + scene.id + " · composition " + scene.compositionNumber + " · " + scene.objects.length + " image elements", scene, sourceText(scene.source), [scene.id, String(scene.compositionNumber), String(scene.objects.length)], scene.objects.map((object) => row("Image element " + object.id + " v" + object.version, object, sourceText(object.source), [String(object.id), "v" + object.version, object.width + "×" + object.height])))),
    ...sup.map((item) => row("Reachable SUP PID 0x" + item.pid.toString(16) + " · " + (item.language ?? "unknown") + " · MPLS " + item.playlistId + " / PlayItem " + item.playItemIndex, item, item.source, ["0x" + item.pid.toString(16), item.language ?? "unknown", "MPLS " + item.playlistId, "PlayItem " + item.playItemIndex])),
  ];
  const relatedIgsClips = [...new Set(data.disc.playlists.flatMap((playlist) => playlist.playItems
    .filter((playItem) => playItem.clipId.toUpperCase() === clipId.toUpperCase())
    .flatMap((playItem) => playItem.streams.flatMap((stream) => {
      if (stream.codingType !== 0x91 || stream.streamType !== 2 || stream.subPathId === null || stream.subClipId === null) return [];
      const target = playlist.subPaths[stream.subPathId]?.items[stream.subClipId]?.clipId;
      return target === undefined ? [] : [target];
    }))))].sort();
  children.push(...relatedIgsClips.map((target) => row("IGS SubPath → M2TS " + target, { clipId: target, relation: "IGS SubPath" }, undefined, [target, "IGS SubPath"], undefined, "clip:" + target)));
  const fileNode = data.disc.graph.nodes.find((node) => node.id === "clip:" + clipId);
  const fileBytes = data.fileSizes[clipId] ?? null;
  const scanned = graphics?.payloadBytesByClip?.has(clipId) ?? false;
  const clipError = graphics?.diagnostics.some((diagnostic) => diagnostic.severity === "error" && diagnostic.source?.clipId === clipId) ?? false;
  const scanStatus = fileNode?.state === "missing" ? "missing" : graphics === null ? "not-run"
    : scanned ? clipError ? "partial" : "scanned" : clipError ? "failed" : "structure-only";
  const reversePlayItems = data.disc.playlists.flatMap((playlist) => playlist.playItems.filter((item) => item.clipId.toUpperCase() === clipId.toUpperCase()).map((item) => ({ playlist: playlist.id, playItemIndex: item.index, source: item.source })));
  const reverseSubPaths = data.disc.playlists.flatMap((playlist) => playlist.subPaths.flatMap((subPath, subPathIndex) => subPath.items.filter((item) => item.clipId.toUpperCase() === clipId.toUpperCase()).map((item) => ({ playlist: playlist.id, subPathIndex, source: item.source }))));
  const value = { clip, fileNode, fileSize: fileBytes, scanStatus, relatedIgsClips, payloadBytes: graphics?.payloadBytesByClip?.get(clipId), scenes, reachableSup: sup, reversePlayItems, reverseSubPaths };
  return row("M2TS " + clipId, value, fileNode?.state === "present" ? sourceText(fileNode.source) : undefined, [clipId, fileBytes === null ? "unknown" : fileBytes + " bytes", scanStatus, scanned ? String(scenes.length) : "unknown", String(sup.length)], children);
}

function buildMplsRows(data: InspectionCollection, targets: Map<string, BrowserRow>): BrowserRow[] {
  return [...data.disc.playlists].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((playlist) => {
    const items = [...playlist.playItems].sort((a, b) => a.index - b.index).map((item) => row("PlayItem " + item.index + " · " + item.clipId + "." + item.codecId, item, sourceText(item.source), [String(item.index), item.clipId + "." + item.codecId, format45kTime(item.inTime45k), format45kTime(item.outTime45k)], undefined, "clip:" + item.clipId));
    const playlistRow = row("MPLS " + playlist.id, playlist, sourceText(playlist.source), [playlist.id, playlist.playItems.length + " PlayItems"], items);
    targets.set("playlist:" + playlist.id, playlistRow);
    return playlistRow;
  });
}

function formatTargetLabel(route: string | undefined, programs: ReadonlyMap<number, { label: string }>): string {
  if (!route) return "unknown";
  if (route.startsWith("playlist:")) return "MPLS " + route.slice("playlist:".length);
  const objectId = route.match(/^object:(\d+)$/)?.[1];
  if (objectId !== undefined) return programs.get(Number(objectId))?.label ?? "MovieObject " + objectId;
  const commandMatch = route.match(/^command:(\d+):(\d+)$/);
  if (commandMatch) return "#" + commandMatch[2];
  return route;
}

function summarizeProgramTargets(commands: BrowserRow[], programs: ReadonlyMap<number, { label: string }>): string {
  const seen = new Set<string>();
  for (const command of commands) {
    const routes = [command.navigateTo, ...(command.children ?? []).map((child) => child.navigateTo)];
    for (const route of routes) {
      if (!route || route.startsWith("command:")) continue;
      seen.add(formatTargetLabel(route, programs));
    }
  }
  const list = [...seen];
  const prefix = `${commands.length} command${commands.length === 1 ? "" : "s"}`;
  return list.length ? `${prefix} · → ${list.join(", ")}` : prefix;
}

function buildNavigationRows(data: InspectionCollection, targets: Map<string, BrowserRow>): { rows: BrowserRow[]; diagnostics: BrowserRow[] } {
  const buttonPrograms = buildButtonPrograms(data.graphics?.scenes ?? []);
  const graph = buildNavigationGraph(data.disc.movieObjects, buttonPrograms.map((item) => item.program), { entries: data.disc.entries });
  const edgesByFrom = new Map<string, NavigationGraphEdge[]>();
  for (const edge of graph.edges) {
    const edges = edgesByFrom.get(edge.from) ?? [];
    edges.push(edge);
    edgesByFrom.set(edge.from, edges);
  }
  const programs = new Map<number, { kindLabel: string; label: string; shortLabel: string; source: string; commands: Array<{ bytes: string; source: { path: string; offset: string } }> }>();
  for (const object of data.disc.movieObjects) {
    const label = "MovieObject " + object.id;
    programs.set(object.id, { kindLabel: "MovieObject", label, shortLabel: label, source: sourceText(object.source) ?? "unknown", commands: normalizedCommands({ instructions: object.instructions }, object.source.path) });
  }
  for (const button of buttonPrograms) {
    programs.set(button.vmId, {
      kindLabel: "IGS Button",
      label: "IGS Button program " + button.programId + " · clip " + button.streamClipId,
      shortLabel: "Button " + button.programId + " · clip " + button.streamClipId,
      source: "STREAM/" + button.streamClipId + ".m2ts",
      commands: normalizedCommands(button.program, "STREAM/" + button.streamClipId + ".m2ts"),
    });
  }

  const disassembled = new Map<string, string>();
  const decodeCommand = (bytes: string): string => {
    const cached = disassembled.get(bytes);
    if (cached !== undefined) return cached;
    let text: string;
    try { text = disassemble(bytes); } catch { text = "raw 0x" + bytes; }
    disassembled.set(bytes, text);
    return text;
  };

  for (const [programId, program] of programs) {
    const commands = program.commands.map((command, index) => {
      const key = "command:" + programId + ":" + index;
      const allEdges = edgesByFrom.get(key) ?? [];
      const flowEdges = allEdges.filter((edge) => edge.kind !== "sequence");
      const links = flowEdges.map((edge) => {
        const target = edge.to ?? "";
        const route = target.startsWith("object:") || target.startsWith("command:") || target.startsWith("playlist:") ? target : undefined;
        const objectId = route?.match(/^object:(\d+)$/)?.[1];
        const commandTarget = route?.match(/^command:(\d+):(\d+)$/);
        const exists = route !== undefined && (targets.has(route)
          || objectId !== undefined && programs.has(Number(objectId))
          || commandTarget?.[1] !== undefined && programs.get(Number(commandTarget[1]))?.commands[Number(commandTarget[2])] !== undefined);
        const targetLabel = formatTargetLabel(route, programs);
        const label = edge.kind === "conditional" && commandTarget
          ? (edge.condition?.includes("true") ? "true → #" + commandTarget[2] : "false → #" + commandTarget[2])
          : edge.resolution === "unresolved" && !exists
            ? edge.kind + " → unresolved"
            : exists
              ? edge.kind + " → " + targetLabel
              : edge.kind + " → data unavailable for " + targetLabel;
        return row(label, edge, sourceText(edge.source), [edge.kind, targetLabel, edge.condition ?? edge.resolution], undefined, exists ? route : undefined);
      });
      const flowSummary = !flowEdges.length
        ? "—"
        : flowEdges.every((edge) => edge.kind === "conditional")
          ? `true → #${index + 1} · false → #${index + 2}`
          : links.map((link) => link.label).join(" · ");
      const instructionText = decodeCommand(command.bytes);
      const directTarget = links.length === 1 ? links[0]!.navigateTo : undefined;
      const children = links.length > 1 ? links : undefined;
      const value = { ...command, programLabel: program.label, instruction: instructionText, edges: allEdges };
      const commandRow = row(
        "Command " + index + " · " + instructionText,
        value,
        sourceText(command.source),
        [String(index), instructionText, flowSummary],
        children,
        directTarget,
      );
      targets.set(key, commandRow);
      return commandRow;
    });
    const summary = summarizeProgramTargets(commands, programs);
    targets.set("object:" + programId, row(program.label, program, program.source, [program.kindLabel, program.shortLabel, summary], commands));
  }

  const bdjos = (data.disc.bdjos ?? []).map((bdjo) => {
    const id = bdjo.path.replace(/^BACKUP\//i, "").replace(/^BDJO\//i, "").replace(/\.BDJO$/i, "").toUpperCase();
    const applications = bdjo.applications.map((application, index) => row("Application " + (index + 1) + " · " + (application.initialClass || "unknown"), application, sourceText(application.source)));
    const item = row("BDJO " + bdjo.path, bdjo, sourceText(bdjo.source), ["BDJO", bdjo.path, applications.length + " applications"], applications);
    targets.set("bdjo:" + id, item);
    return item;
  });

  const entries = data.disc.entries.map((entry) => {
    const edge = data.disc.graph.edges.find((candidate) => candidate.from === "entry:" + entry.id);
    const objectId = edge?.to?.match(/^movieObject:(\d+)$/)?.[1];
    const bdjoId = edge?.to?.match(/^bdjo:(.+)$/)?.[1]?.toUpperCase();
    const bdjo = bdjoId ? (data.disc.bdjos ?? []).find((item) => item.path.replace(/^BACKUP\//i, "").replace(/^BDJO\//i, "").replace(/\.BDJO$/i, "").toUpperCase() === bdjoId) : undefined;
    const targetKey = objectId ? "object:" + objectId : bdjo ? "bdjo:" + bdjoId : undefined;
    const targetRow = targetKey ? targets.get(targetKey) : undefined;
    const targetName = entry.target.objectType === "HDMV" ? "MovieObject " + (entry.target.target ?? "unknown") : "BDJO " + (entry.target.target ?? "unknown");
    const summary = targetRow && objectId
      ? `→ ${targetName} (${summarizeProgramTargets(targetRow.children ?? [], programs)})`
      : targetRow && bdjo
        ? `→ BDJO ${bdjoId} (${bdjo.applications.length} apps)`
        : `→ ${targetName} (unresolved)`;
    const label = entry.id.startsWith(entry.kind) ? entry.id : entry.kind + " " + entry.id;
    return row(label, { ...entry, edge, bdjo }, sourceText(entry.source), [entry.kind, entry.id, summary], undefined, targetRow ? targetKey : undefined);
  });
  const objects = data.disc.movieObjects.map((object) => targets.get("object:" + object.id)!);
  const buttons = buttonPrograms.map((button) => targets.get("object:" + button.vmId)!);
  const diagnostics = [
    row("Static navigation analysis · " + (graph.complete ? "complete" : "incomplete") + " · " + graph.explored + " states · " + graph.diagnostics.length + " diagnostics", { complete: graph.complete, explored: graph.explored, diagnostics: graph.diagnostics }),
    ...graph.diagnostics.map((message) => row("Static navigation · " + message, message)),
    ...graph.edges.filter((edge) => edge.resolution === "unresolved").map((edge) => row("Unresolved " + edge.kind + " from " + edge.from + " · " + (edge.condition ?? "unknown condition"), edge, sourceText(edge.source))),
  ];
  return { rows: [...entries, ...objects, ...bdjos, ...buttons], diagnostics };
}

export function buildInspectionBrowserModel(data: InspectionCollection): InspectionBrowserModel {
  const targets = new Map<string, BrowserRow>();
  const clipIds = new Set<string>([
    ...data.disc.graph.nodes.filter((node) => node.type === "clip").map((node) => node.id.slice("clip:".length)),
    ...data.disc.playlists.flatMap((playlist) => playlist.playItems.map((item) => item.clipId)),
    ...data.disc.playlists.flatMap((playlist) => playlist.subPaths.flatMap((subPath) => subPath.items.map((item) => item.clipId))),
    ...(data.graphics?.streams.map((item) => item.clipId) ?? []),
    ...data.reachableSup.map((item) => item.clipId),
  ]);
  for (const clipId of clipIds) targets.set("clip:" + clipId, m2tsRow(data, clipId));
  const mpls = buildMplsRows(data, targets);
  const navigation = buildNavigationRows(data, targets);
  const m2ts = [...clipIds].filter((clipId) => {
    if (!selectedClip(clipId, data.assetSelection)) return false;
    if (data.assetSelection.pid === undefined) return true;
    const hasIgs = data.assetType !== "sup" && (data.graphics?.scenes.some((scene) => scene.clipId === clipId && selectedPid(scene.pid, data.assetSelection)) ?? false);
    const hasSup = data.assetType !== "igs" && data.reachableSup.some((item) => item.clipId === clipId && selectedPid(item.pid, data.assetSelection));
    return hasIgs || hasSup;
  }).sort().map((clipId) => targets.get("clip:" + clipId)!);
  return {
    Navigation: navigation.rows,
    MPLS: mpls,
    M2TS: m2ts,
    Metadata: [
      ...(data.disc.discInfo.appInfo ? [row("Disc application info", data.disc.discInfo.appInfo, sourceText(data.disc.discInfo.appInfo.source))] : []),
      ...(data.disc.discInfo.uhd ? [row("UHD information", data.disc.discInfo.uhd, sourceText(data.disc.discInfo.uhd.source))] : []),
      ...(data.disc.metadata ?? []).map((item) => row(item.language + " · " + (item.discName ?? "unknown"), item, sourceText(item.source))),
    ],
    Diagnostics: [
      ...navigation.diagnostics,
      ...data.disc.diagnostics.map((item) => row(item.severity + " " + item.code + " · " + item.message, item, (item.sourcePath ?? "unknown") + (item.offset === null ? "" : " @ " + item.offset))),
      ...(data.graphics?.diagnostics ?? []).map((item) => row(item.severity + " " + item.code + " · " + item.message, item, sourceText(item.source))),
    ],
    targets,
  };
}
