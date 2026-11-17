import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { TextInput } from "@inkjs/ui";
import wrapAnsi from "wrap-ansi";
import type { InspectionCollection } from "./inspect-collection.js";
import { INSPECTION_SECTIONS, type BrowserRow, type InspectionBrowserModel, type InspectionSection } from "./inspect-browser-model.js";
import { format45kTime, projectInspectReport } from "./inspect-report.js";
import { buildInspectionDetails, type InspectionDetailLine } from "./inspect-details.js";
import { imagePreview, supImagePreview, type ImagePreviewOverlay } from "./inspect-image-preview.js";

type TableKind = "navigation" | "playlists" | "items" | "clips" | "programs" | "commands" | "edges" | "images" | "supSets" | "records";
interface Location { rows: BrowserRow[]; kind: TableKind; label: string; selected: number; filter: string; detailScroll: number; }
interface BrowserState { section: InspectionSection; location: Location; parents: Location[]; details: boolean; help: boolean; searching: boolean; }
type Action = { type: "move"; delta: number } | { type: "section"; delta: number } | { type: "open" } | { type: "back" } | { type: "details" } | { type: "help" } | { type: "search" } | { type: "filter"; value: string } | { type: "scroll"; delta: number; max: number };

function visibleRows(location: Location): BrowserRow[] {
  const filter = location.filter.toLocaleLowerCase();
  return filter ? location.rows.filter((row) => [row.label, ...row.cells].join(" ").toLocaleLowerCase().includes(filter)) : location.rows;
}

function rootKind(section: InspectionSection): TableKind {
  return section === "Navigation" ? "navigation" : section === "MPLS" ? "playlists" : section === "M2TS" ? "clips" : "records";
}

function childKind(row: BrowserRow): TableKind {
  if (row.label.startsWith("MPLS ")) return "items";
  if (row.label.startsWith("MovieObject ") || row.label.startsWith("IGS Button program ")) return "commands";
  if (row.label.startsWith("Command ") || row.label.startsWith("firstPlay ") || row.label.startsWith("topMenu ") || row.label.startsWith("title ")) return "edges";
  if (row.label.startsWith("IGS scene ")) return "images";
  if (row.label.startsWith("Reachable SUP ") || row.label.startsWith("SUP PID ")) return "supSets";
  return "records";
}

function targetKind(id: string): TableKind {
  return id.startsWith("clip:") ? "clips" : id.startsWith("playlist:") ? "playlists" : id.startsWith("object:") ? "programs" : id.startsWith("command:") ? "commands" : "records";
}

function resolveOpenLocation(current: BrowserRow, model: InspectionBrowserModel): Location | undefined {
  const route = current.navigateTo;
  if (route) {
    const commandMatch = route.match(/^command:(\d+):(\d+)$/);
    if (commandMatch) {
      const program = model.targets.get("object:" + commandMatch[1]);
      if (program?.children?.length) {
        const index = Math.max(0, Math.min(program.children.length - 1, Number(commandMatch[2])));
        return { rows: program.children, kind: "commands", label: `${program.label} (#${index})`, selected: index, filter: "", detailScroll: 0 };
      }
    }
    const target = model.targets.get(route);
    if (route.startsWith("object:") && target?.children?.length) {
      const label = current.label === target.label || current.label.startsWith("Command ") ? target.label : `${current.label} → ${target.label}`;
      return { rows: target.children, kind: "commands", label, selected: 0, filter: "", detailScroll: 0 };
    }
    if (route.startsWith("bdjo:") && target?.children?.length) {
      const label = current.label === target.label ? target.label : `${current.label} → ${target.label}`;
      return { rows: target.children, kind: "records", label, selected: 0, filter: "", detailScroll: 0 };
    }
    if (route.startsWith("playlist:") && target) {
      const index = model.MPLS.indexOf(target);
      if (index >= 0) return { rows: model.MPLS, kind: "playlists", label: target.label, selected: index, filter: "", detailScroll: 0 };
      if (target.children?.length) return { rows: target.children, kind: "items", label: target.label, selected: 0, filter: "", detailScroll: 0 };
    }
    if (route.startsWith("clip:") && target) {
      const index = model.M2TS.indexOf(target);
      if (index >= 0) return { rows: model.M2TS, kind: "clips", label: target.label, selected: index, filter: "", detailScroll: 0 };
      return { rows: [target], kind: "clips", label: target.label, selected: 0, filter: "", detailScroll: 0 };
    }
    if (target) return { rows: [target], kind: targetKind(route), label: target.label, selected: 0, filter: "", detailScroll: 0 };
  }
  if (!current.children?.length) return undefined;
  return { rows: current.children, kind: childKind(current), label: current.label, selected: 0, filter: "", detailScroll: 0 };
}

function initialState(model: InspectionBrowserModel): BrowserState {
  return { section: "Navigation", location: { rows: model.Navigation, kind: "navigation", label: "Navigation", selected: 0, filter: "", detailScroll: 0 }, parents: [], details: true, help: false, searching: false };
}

function transition(state: BrowserState, action: Action, model: InspectionBrowserModel): BrowserState {
  const { location } = state;
  const update = (change: Partial<Location>): BrowserState => ({ ...state, location: { ...location, ...change } });
  if (action.type === "move") return update({ selected: Math.max(0, Math.min(visibleRows(location).length - 1, location.selected + action.delta)), detailScroll: 0 });
  if (action.type === "scroll") return update({ detailScroll: Math.max(0, Math.min(action.max, location.detailScroll + action.delta)) });
  if (action.type === "details") return { ...state, details: !state.details };
  if (action.type === "help") return { ...state, help: !state.help };
  if (action.type === "search") return { ...state, searching: true };
  if (action.type === "filter") return { ...update({ filter: action.value, selected: 0, detailScroll: 0 }), searching: false };
  if (action.type === "back") {
    if (state.searching) return { ...state, searching: false };
    if (state.help) return { ...state, help: false };
    const parent = state.parents.at(-1);
    return parent ? { ...state, location: parent, parents: state.parents.slice(0, -1) } : state;
  }
  if (action.type === "section") {
    const index = (INSPECTION_SECTIONS.indexOf(state.section) + action.delta + INSPECTION_SECTIONS.length) % INSPECTION_SECTIONS.length;
    const section = INSPECTION_SECTIONS[index]!;
    return { ...state, section, location: { rows: model[section], kind: rootKind(section), label: section, selected: 0, filter: "", detailScroll: 0 }, parents: [] };
  }
  const current = visibleRows(location)[location.selected];
  if (!current) return state;
  const next = resolveOpenLocation(current, model);
  if (!next) return state;
  return { ...state, parents: [...state.parents, location], location: next };
}

const HEADERS: Record<TableKind, string[]> = {
  navigation: ["Kind", "Entry / Program", "Target / Summary"],
  playlists: ["MPLS", "Duration", "PlayItems", "Marks"],
  items: ["Index", "Clip", "IN", "OUT"],
  clips: ["Clip", "File size", "Scan", "IGS scenes", "SUP refs"],
  programs: ["Program", "Commands"],
  commands: ["#", "Instruction", "Target / Flow"],
  edges: ["Kind", "Target", "Condition / state"],
  images: ["Object", "Version", "Dimensions"],
  supSets: ["#", "Timeline", "Dimensions", "Position (Canvas)"],
  records: ["Record"],
};
const COLUMN_WIDTHS: Record<TableKind, number[]> = {
  navigation: [18, 24, 58],
  playlists: [22, 34, 22, 22],
  items: [16, 28, 28, 28],
  clips: [18, 26, 22, 17, 17],
  programs: [60, 40],
  commands: [12, 53, 35],
  edges: [22, 33, 45],
  images: [30, 30, 40],
  supSets: [12, 42, 20, 26],
  records: [100],
};
const ORDER: Partial<Record<TableKind, string>> = { navigation: "entry declarations; programs", playlists: "MPLS filename", items: "PlayItem index", clips: "clip ID", commands: "command index", supSets: "display set index" };

function cells(row: BrowserRow, kind: TableKind, durations: ReadonlyMap<string, string>): string[] {
  if (kind === "records") return [row.label];
  if (kind === "playlists") {
    const playlist = row.value as { id: string; playItems: unknown[]; marks: unknown[] };
    return [playlist.id, durations.get(playlist.id) ?? "unknown", String(playlist.playItems.length), String(playlist.marks.length)];
  }
  if (kind === "navigation" && row.cells.length !== 3) return [row.label.startsWith("BDJO") ? "BDJO" : "Program", row.cells[0] ?? row.label, row.cells[1] ?? "unknown"];
  return row.cells;
}

export function InspectionBrowserView({
  data,
  model,
  structureStatus,
  overlay,
  graphicsAvailable,
  onLoadSup,
  onCancelSup,
  onPrioritizeClip,
  pendingSupOpen,
}: {
  data: InspectionCollection;
  model: InspectionBrowserModel;
  structureStatus: "complete" | "partial" | "failed";
  overlay: ImagePreviewOverlay;
  graphicsAvailable: boolean;
  onLoadSup?: (clipId: string, m2tsPath: string, requests: unknown[]) => void;
  onCancelSup?: (clipId: string) => void;
  onPrioritizeClip?: (clipId: string) => void;
  pendingSupOpen?: string | null;
}): React.ReactElement {
  const { exit } = useApp();
  const window = useWindowSize();
  const dimensions = { width: window.columns || 80, height: window.rows || 24 };
  const [state, dispatch] = useReducer((current: BrowserState, action: Action) => transition(current, action, model), model, initialState);
  const durations = useMemo(() => new Map(projectInspectReport(data.disc).playlists.map(({ playlist, duration45k }) => [playlist.id, format45kTime(duration45k)])), [data.disc]);
  const [preview, setPreview] = useState(false);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [loadingSup, setLoadingSup] = useState<string | null>(null);
  const activeClipIdRef = useRef<string | null>(null);

  const { location } = state;
  const rows = visibleRows(location);
  const current = rows[location.selected];

  useEffect(() => {
    if (pendingSupOpen && current?.supLoader?.clipId?.toUpperCase() === pendingSupOpen.toUpperCase() && current.children) {
      setLoadingSup(null);
      dispatch({ type: "open" });
    }
  }, [data, pendingSupOpen, current]);

  const wide = dimensions.width >= 110;
  const extraLines = Number(state.searching || Boolean(location.filter)) + (state.help ? 2 : 0) + Number(Boolean(loadingSup));
  const mainHeight = Math.max(4, dimensions.height - 6 - extraLines);
  const showDetails = state.details || preview;
  const tableHeight = !showDetails || wide ? mainHeight : Math.max(3, Math.floor((mainHeight - 1) / 2));
  const tableRows = Math.max(1, tableHeight - 2);
  const tableWidth = wide && showDetails ? Math.floor(dimensions.width * 0.5) : dimensions.width;
  const detailHeight = wide ? mainHeight : mainHeight - tableHeight - 1;
  const detailWidth = Math.max(1, wide ? dimensions.width - tableWidth - 1 : dimensions.width);
  const detailLines = useMemo((): InspectionDetailLine[] => {
    if (!current) return [{ kind: "field", text: "No records" }];
    return buildInspectionDetails(current, data, model).flatMap((line, index) => [
      ...(line.kind === "heading" && index > 0 ? [{ kind: "field" as const, text: "" }] : []),
      ...wrapAnsi(line.text, detailWidth, { hard: true, trim: false }).split("\n").map((text) => ({ ...line, text })),
    ]);
  }, [current, data, model, detailWidth]);
  const detailRows = Math.max(1, detailHeight - 1);
  const scrollMax = Math.max(0, detailLines.length - detailRows);
  const detailStart = Math.min(location.detailScroll, scrollMax);

  const image = useMemo(() => current?.imagePreview && current.imagePreview.kind !== "sup" ? imagePreview(current.imagePreview.scene, current.imagePreview.object) : undefined, [current]);
  const supImage = useMemo(() => current?.imagePreview?.kind === "sup" ? supImagePreview(current.imagePreview.summary) : undefined, [current]);
  const palette = image?.palettes[paletteIndex % image.palettes.length];
  const previewError = useMemo(() => {
    if (!preview || (!image && !supImage) || (!palette && image)) return undefined;
    const x = wide ? tableWidth + 2 : 1;
    const y = 8 + extraLines + (wide ? 0 : tableHeight + 1);
    try {
      if (supImage) {
        overlay.showSup(supImage, { x, y, columns: detailWidth, rows: Math.max(1, detailHeight - 2) });
      } else if (image && palette) {
        overlay.show(image, palette, { x, y, columns: detailWidth, rows: Math.max(1, detailHeight - 2) });
      }
      return undefined;
    } catch (error) { return error instanceof Error ? error.message : String(error); }
  }, [preview, image, supImage, palette, graphicsAvailable, wide, tableWidth, tableHeight, extraLines, detailWidth, detailHeight, overlay]);

  useInput((input, key) => {
    if (state.searching) { if (key.escape) dispatch({ type: "back" }); return; }
    if (preview) {
      if (input === " " || key.escape) { overlay.clear(); setPreview(false); }
      else if (key.upArrow || key.downArrow) {
        const delta = key.upArrow ? -1 : 1;
        if (location.selected + delta >= 0 && location.selected + delta < rows.length) {
          overlay.clear(); setPaletteIndex(0); dispatch({ type: "move", delta });
        }
      } else if (image && image.palettes.length > 1 && (key.leftArrow || key.rightArrow)) {
        overlay.clear();
        setPaletteIndex((paletteIndex + (key.rightArrow ? 1 : -1) + image.palettes.length) % image.palettes.length);
      } else if (input === "q") {
        if (activeClipIdRef.current) onCancelSup?.(activeClipIdRef.current);
        overlay.clear(); exit();
      }
      return;
    }
    if (input === "q") {
      if (activeClipIdRef.current) onCancelSup?.(activeClipIdRef.current);
      exit();
      return;
    }
    if (key.escape) {
      if (activeClipIdRef.current) {
        onCancelSup?.(activeClipIdRef.current);
        activeClipIdRef.current = null;
        setLoadingSup(null);
      }
      dispatch({ type: "back" });
    }
    else if (key.upArrow) dispatch({ type: "move", delta: -1 });
    else if (key.downArrow) dispatch({ type: "move", delta: 1 });
    else if (input === " " && current?.imagePreview) { setPaletteIndex(0); setPreview(true); }
    else if (key.return) {
      if (current?.supLoader && !current.children && !loadingSup) {
        const loader = current.supLoader;
        activeClipIdRef.current = loader.clipId;
        onPrioritizeClip?.(loader.clipId);
        onLoadSup?.(loader.clipId, loader.m2tsPath, [loader.item]);
        setLoadingSup("Loading SUP PID 0x" + loader.item.pid.toString(16) + " in background...");
        return;
      }
      dispatch({ type: "open" });
    }
    else if (key.leftArrow && !state.parents.length) {
      if (activeClipIdRef.current) { onCancelSup?.(activeClipIdRef.current); activeClipIdRef.current = null; setLoadingSup(null); }
      dispatch({ type: "section", delta: -1 });
    }
    else if (key.rightArrow && !state.parents.length) {
      if (activeClipIdRef.current) { onCancelSup?.(activeClipIdRef.current); activeClipIdRef.current = null; setLoadingSup(null); }
      dispatch({ type: "section", delta: 1 });
    }
    else if (key.pageUp) dispatch({ type: "scroll", delta: -detailRows, max: scrollMax });
    else if (key.pageDown) dispatch({ type: "scroll", delta: detailRows, max: scrollMax });
    else if (input === "/") dispatch({ type: "search" });
    else if (input === "d") dispatch({ type: "details" });
    else if (input === "?") dispatch({ type: "help" });
  });

  const headers = HEADERS[location.kind];
  const widths = COLUMN_WIDTHS[location.kind];
  const windowStart = Math.max(0, Math.min(location.selected - Math.floor(tableRows / 2), rows.length - tableRows));
  const renderCells = (values: string[], selected: boolean, header = false): React.ReactElement => React.createElement(Box, { flexDirection: "row", width: tableWidth, height: 1, flexShrink: 0, ...(selected ? { backgroundColor: "cyan" } : {}) },
    ...values.map((value, index) => React.createElement(Box, { key: index, width: `${widths[index] ?? 100 / headers.length}%` }, React.createElement(Text, { wrap: "truncate-end", bold: header, ...(selected ? { color: "black" as const } : {}) }, (index === 0 && !header ? selected ? "> " : "  " : "") + value))));
  const table = React.createElement(Box, { flexDirection: "column", width: tableWidth, height: tableHeight, flexShrink: 0 },
    renderCells(headers, false, true),
    ...rows.slice(windowStart, windowStart + tableRows).map((row, index) => React.createElement(React.Fragment, { key: windowStart + index }, renderCells(cells(row, location.kind, durations), windowStart + index === location.selected))),
    rows.length ? null : React.createElement(Text, { dimColor: true }, "No records"),
    React.createElement(Text, { dimColor: true, wrap: "truncate-end" }, `${rows.length ? location.selected + 1 : 0}/${rows.length}${ORDER[location.kind] ? " | Order: " + ORDER[location.kind] : ""}${!state.details && current?.source ? " | Source: " + current.source : ""}`));
  const previewMessage = supImage ? `${supImage.summary.startTimeText} → ${supImage.summary.endTimeText} · canvas ${supImage.summary.displaySet.width}×${supImage.summary.displaySet.height} at (${supImage.summary.boxX}, ${supImage.summary.boxY})` : !image ? "No image element selected" : !palette ? "No palette is available for this scene" : !graphicsAvailable ? "Image preview requires a supported graphics terminal outside tmux or screen" : previewError ? `Preview failed: ${previewError}` : `Palette ${palette.id} v${palette.version} (${paletteIndex + 1}/${image.palettes.length}) · ←→ palette`;
  const details = showDetails ? React.createElement(Box, { flexDirection: "column", width: detailWidth, height: detailHeight, marginLeft: wide ? 1 : 0, marginTop: wide ? 0 : 1, flexShrink: 0 },
    ...(preview ? [
      React.createElement(Text, { key: "title", bold: true, color: "cyan", wrap: "truncate-end" }, supImage ? `Preview · SUP #${supImage.summary.displaySetNumber} · ${supImage.width}×${supImage.height}` : image ? `Preview · ${image.object.width}×${image.object.height}` : "Preview"),
      React.createElement(Text, { key: "message", dimColor: true, wrap: "truncate-end" }, previewMessage),
    ] : [
      ...detailLines.slice(detailStart, detailStart + detailRows).map((line, index) => React.createElement(Text, { key: detailStart + index, wrap: "truncate-end", bold: line.kind === "heading", dimColor: line.kind === "source", ...(line.kind === "heading" ? { color: "cyan" as const } : {}) }, line.text)),
      React.createElement(Text, { key: "scroll", dimColor: true, wrap: "truncate-end" }, `${Math.min(detailStart + detailRows, detailLines.length)}/${detailLines.length} | PgUp/PgDn`),
    ])) : null;
  const path = [state.section, ...state.parents.slice(1).map((parent) => parent.label), ...(state.parents.length ? [location.label] : [])].join(" > ");

  return React.createElement(Box, { flexDirection: "column", width: dimensions.width },
    React.createElement(Text, { bold: true, color: "cyan", wrap: "truncate-end" }, `bdmv2web inspect | Structure: ${structureStatus} | Graphics: ${data.graphicsStageStatus}`),
    React.createElement(Text, { dimColor: true, wrap: "truncate-middle" }, data.disc.root),
    React.createElement(Text, { wrap: "truncate-end" }, INSPECTION_SECTIONS.map((section) => state.section === section ? "[" + section + "]" : section).join("  ")),
    React.createElement(Text, { wrap: "truncate-middle" }, path),
    loadingSup ? React.createElement(Text, { color: "yellow", wrap: "truncate-end" }, loadingSup) : null,
    state.searching ? React.createElement(Box, { height: 1 }, React.createElement(Text, null, "Filter: "), React.createElement(TextInput, { defaultValue: location.filter, placeholder: "filter current table", onSubmit: (value) => dispatch({ type: "filter", value }) }))
      : location.filter ? React.createElement(Text, { dimColor: true, wrap: "truncate-end" }, "Filter: " + location.filter + " | / to edit") : null,
    state.help ? React.createElement(Box, { flexDirection: "column", height: 2 }, React.createElement(Text, { wrap: "truncate-end" }, "Enter follows indexed targets; Esc restores the previous selection and filter."), React.createElement(Text, { wrap: "truncate-end" }, "Left/Right changes top-level sections; d toggles details; / then Enter clears a filter.")) : null,
    React.createElement(Box, { flexDirection: wide ? "row" : "column", height: mainHeight, marginTop: 1 }, table, details),
    React.createElement(Text, { dimColor: true, wrap: "truncate-end" }, "↑↓ row ←→ section | Enter open | Space preview | Esc back | / filter | ? help | q quit"));
}
