import type { ParsedDisc, SourceLocation } from "@bdmv-web/bdmv-parser";
import type { NavigationGraph, NavigationGraphEdge, NavigationGraphNode } from "@bdmv-web/hdmv";

export interface MediaClosureOptions { maxStates?: number; }
export interface MediaClosureUnknown { code: string; message: string; source: SourceLocation | null; }
export interface MediaClosureRoute {
  playlistId: string;
  origin: "entry" | "button-program" | "conservative-fallback";
  entryId: string | null;
  entrySource: SourceLocation | null;
  buttonProgramId: number | null;
  navigationEdges: Array<{ from: string; to: string | null; kind: string; condition: string | null; source: SourceLocation }>;
}
export interface MediaClosure {
  playlistIds: string[];
  clipIds: string[];
  streamIds: string[];
  requiredNodeIds: string[];
  routes: MediaClosureRoute[];
  unknown: MediaClosureUnknown[];
  complete: boolean;
  explored: number;
}

const MEDIA_NODE_TYPES = new Set(["playlist", "playItem", "subPath", "clip", "clipInfo"]);

/**
 * Merge M1 structural roots with M3 object/control-flow graphs. Conditional
 * edges with known destinations are both traversed as a union. Unresolved
 * navigation widens the package to every declared playlist and remains unknown.
 */
export function computeMediaClosure(
  disc: ParsedDisc,
  movieGraph: NavigationGraph,
  buttonGraphs: readonly NavigationGraph[] = [],
  options: MediaClosureOptions = {},
): MediaClosure {
  const maxStates = options.maxStates ?? 100_000;
  if (!Number.isSafeInteger(maxStates) || maxStates < 0) throw new RangeError("maxStates must be a non-negative safe integer");

  const structuralNodes = new Map(disc.graph.nodes.map((node) => [node.id, node]));
  const structuralEdges = new Map<string, typeof disc.graph.edges>();
  for (const edge of disc.graph.edges) structuralEdges.set(edge.from, [...(structuralEdges.get(edge.from) ?? []), edge]);
  const allPlaylists = disc.graph.nodes.filter((node) => node.type === "playlist").map((node) => node.id);
  const selectedPlaylists = new Set<string>();
  const requiredNodes = new Set<string>();
  const routes: MediaClosureRoute[] = [];
  const unknown: MediaClosureUnknown[] = [];
  const unknownKeys = new Set<string>();
  let explored = 0;
  let budgetExhausted = false;

  const markUnknown = (code: string, message: string, source: SourceLocation | null = null) => {
    const key = `${code}\0${message}\0${source?.path ?? ""}\0${source?.offset ?? ""}`;
    if (!unknownKeys.has(key)) { unknownKeys.add(key); unknown.push({ code, message, source }); }
  };
  const recordRoute = (route: MediaClosureRoute) => {
    const signature = `${route.playlistId}\0${route.origin}\0${route.entryId ?? ""}\0${route.buttonProgramId ?? ""}\0${route.navigationEdges.map((edge) => `${edge.from}:${edge.to}:${edge.kind}:${edge.source.path}:${edge.source.offset}`).join("|")}`;
    if (!routes.some((item) => `${item.playlistId}\0${item.origin}\0${item.entryId ?? ""}\0${item.buttonProgramId ?? ""}\0${item.navigationEdges.map((edge) => `${edge.from}:${edge.to}:${edge.kind}:${edge.source.path}:${edge.source.offset}`).join("|")}` === signature)) routes.push(route);
  };
  const widenToAllPlaylists = () => {
    for (const id of allPlaylists) selectedPlaylists.add(id);
    // Widen by scanning the already parsed structural graph. This bounded
    // graph walk is deliberately independent of navigation exploration budget.
    for (const node of disc.graph.nodes) {
      if (MEDIA_NODE_TYPES.has(node.type) || node.type === "stream") {
        requiredNodes.add(node.id);
        if (node.state !== "present") markUnknown("MEDIA_STRUCTURE_MISSING", `Potentially reachable structural node '${node.id}' is missing.`, node.source);
      }
    }
  };

  const includePlaylist = (rootId: string): void => {
    if (!rootId.startsWith("playlist:")) {
      markUnknown("MEDIA_TARGET_UNRESOLVED", `Navigation target '${rootId}' is not a playlist node.`);
      widenToAllPlaylists();
      return;
    }
    selectedPlaylists.add(rootId);
    const pending = [rootId];
    const seen = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const node = structuralNodes.get(id);
      if (!node || node.state !== "present") {
        markUnknown("MEDIA_STRUCTURE_MISSING", `Required structural node '${id}' is missing.`, node?.source ?? null);
        continue;
      }
      if (node.type === "playlist" || MEDIA_NODE_TYPES.has(node.type)) requiredNodes.add(id);
      for (const edge of structuralEdges.get(id) ?? []) {
        if (edge.resolution !== "resolved") markUnknown("MEDIA_STRUCTURE_UNRESOLVED", `Structural edge '${edge.kind}' from '${edge.from}' to '${edge.to}' is ${edge.resolution}.`, edge.source);
        if (!structuralNodes.has(edge.to) || structuralNodes.get(edge.to)?.state !== "present") {
          markUnknown("MEDIA_STRUCTURE_MISSING", `Required structural target '${edge.to}' is missing.`, edge.source);
        } else if (MEDIA_NODE_TYPES.has(structuralNodes.get(edge.to)!.type)) pending.push(edge.to);
      }
      if (explored >= maxStates) {
        budgetExhausted = true;
        markUnknown("MEDIA_CLOSURE_BUDGET", `Structural media closure exceeded maxStates=${maxStates}.`, node.source);
        return;
      }
      explored++;
    }
  };

  const runNavigation = (graph: NavigationGraph, roots: Array<{ id: string; entryId: string | null; entrySource: SourceLocation | null; buttonProgramId: number | null; origin: "entry" | "button-program" }>, label: string): void => {
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const edgesBySource = new Map<string, NavigationGraphEdge[]>();
    for (const edge of graph.edges) edgesBySource.set(edge.from, [...(edgesBySource.get(edge.from) ?? []), edge]);
    if (!graph.complete) {
      markUnknown("MEDIA_NAVIGATION_INCOMPLETE", `${label} navigation graph is incomplete: ${graph.diagnostics.join("; ") || "unresolved states remain"}.`);
      widenToAllPlaylists();
    }
    for (const root of roots) {
    const pending = [root.id];
    const seen = new Set<string>();
    const observedEdges = new Map<string, NavigationGraphEdge>();
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      const node = nodes.get(id);
      if (!node) {
        markUnknown("MEDIA_NAVIGATION_TARGET_MISSING", `${label} navigation target '${id}' is absent.`);
        widenToAllPlaylists();
        continue;
      }
      seen.add(id);
      if (node.status === "unknown") {
        markUnknown("MEDIA_NAVIGATION_NODE_UNKNOWN", `${label} navigation node '${id}' has unknown status.`, node.source);
        widenToAllPlaylists();
      }
      // The current M3 graph publishes object and command nodes but omits the
      // implicit PC=0 edge; start at its declared first command when present.
      if (node.kind === "object" && nodes.has(`command:${node.objectId}:0`)) pending.push(`command:${node.objectId}:0`);
      if (explored >= maxStates) {
        budgetExhausted = true;
        markUnknown("MEDIA_CLOSURE_BUDGET", `Navigation closure exceeded maxStates=${maxStates} while visiting '${id}'.`, node.source);
        widenToAllPlaylists();
        return;
      }
      explored++;
      for (const edge of edgesBySource.get(id) ?? []) {
        observedEdges.set(`${edge.from}\0${edge.to ?? ""}\0${edge.kind}\0${edge.condition ?? ""}\0${edge.source.path}\0${edge.source.offset}`, edge);
        followNavigationEdge(edge, nodes, pending, label, root, [...observedEdges.values()]);
      }
    }
    }

    function followNavigationEdge(edge: NavigationGraphEdge, navNodes: Map<string, NavigationGraphNode>, queue: string[], graphLabel: string, root: (typeof roots)[number], observed: NavigationGraphEdge[]): void {
      if (edge.kind === "conditional") {
        // Both known destinations are candidates even while the predicate is unresolved.
        if (edge.to !== null && navNodes.has(edge.to)) { queue.push(edge.to); return; }
        markUnknown("MEDIA_CONDITIONAL_TARGET_UNKNOWN", `Conditional edge from '${edge.from}' has no known destination.`, edge.source);
        widenToAllPlaylists();
        return;
      }
      if (edge.kind === "play") {
        if (edge.to !== null && structuralNodes.get(edge.to)?.type === "playlist" && edge.resolution === "resolved") {
          includePlaylist(edge.to);
          recordRoute({ playlistId: edge.to, origin: root.origin, entryId: root.entryId, entrySource: root.entrySource, buttonProgramId: root.buttonProgramId, navigationEdges: observed.map(({ from, to, kind, condition, source }) => ({ from, to, kind, condition, source })) });
          return;
        }
        markUnknown("MEDIA_PLAY_TARGET_UNKNOWN", `${graphLabel} play/title navigation edge from '${edge.from}' has no proven playlist target.`, edge.source);
        widenToAllPlaylists();
        return;
      }
      if (edge.resolution === "resolved" && edge.to !== null && navNodes.has(edge.to)) { queue.push(edge.to); return; }
      if (edge.to !== null && structuralNodes.get(edge.to)?.type === "playlist" && edge.resolution === "resolved") { includePlaylist(edge.to); return; }
      if (edge.resolution !== "resolved" || edge.to === null) {
        markUnknown("MEDIA_NAVIGATION_TARGET_UNKNOWN", `${graphLabel} ${edge.kind} edge from '${edge.from}' is unresolved.`, edge.source);
        widenToAllPlaylists();
        return;
      }
      markUnknown("MEDIA_NAVIGATION_TARGET_MISSING", `${graphLabel} edge target '${edge.to}' is not present in either navigation or structural graph.`, edge.source);
      widenToAllPlaylists();
    }
  };

  const entryRoots: Array<{ id: string; entryId: string | null; entrySource: SourceLocation | null; buttonProgramId: number | null; origin: "entry" | "button-program" }> = [];
  if (disc.entries.length === 0) {
    markUnknown("MEDIA_ENTRY_SET_UNKNOWN", "No declared entries are available to establish media roots.");
    widenToAllPlaylists();
  }
  for (const entry of disc.entries) {
    const edge = structuralEdges.get(`entry:${entry.id}`)?.find((candidate) => candidate.kind === "entry-target");
    if (entry.target.objectType === "HDMV" && typeof entry.target.target === "number") {
      const objectId = `object:${entry.target.target}`;
      if (structuralNodes.get(`movieObject:${entry.target.target}`)?.state === "present" && movieGraph.nodes.some((node) => node.id === objectId)) entryRoots.push({ id: objectId, entryId: entry.id, entrySource: entry.source, buttonProgramId: null, origin: "entry" });
      else {
        markUnknown("MEDIA_ENTRY_TARGET_UNKNOWN", `Entry '${entry.id}' references an unavailable MovieObject ${entry.target.target}.`, edge?.source ?? entry.source);
        widenToAllPlaylists();
      }
    } else {
      markUnknown("MEDIA_ENTRY_TARGET_UNKNOWN", `Entry '${entry.id}' has ${entry.target.objectType} or unresolved navigation; its media closure is unknown.`, entry.source);
      widenToAllPlaylists();
    }
  }
  runNavigation(movieGraph, entryRoots, "MovieObject");
  buttonGraphs.forEach((graph, index) => runNavigation(graph, graph.nodes.filter((node) => node.kind === "object").map((node) => ({ id: node.id, entryId: null, entrySource: null, buttonProgramId: node.objectId, origin: "button-program" as const })), `button program ${index}`));

  if (budgetExhausted || unknown.length > 0) widenToAllPlaylists();
  for (const playlistId of selectedPlaylists) if (!routes.some((route) => route.playlistId === playlistId)) recordRoute({ playlistId, origin: "conservative-fallback", entryId: null, entrySource: null, buttonProgramId: null, navigationEdges: [] });
  for (const playlistId of selectedPlaylists) includePlaylist(playlistId);
  const clipIds = new Set([...requiredNodes].filter((id) => id.startsWith("clip:")).map((id) => id.slice("clip:".length)));
  const streamIds = new Set<string>();
  for (const node of disc.graph.nodes) if (node.type === "stream" && [...clipIds].some((clipId) => node.id.startsWith(`stream:${clipId}:`))) { streamIds.add(node.id); requiredNodes.add(node.id); }
  return {
    playlistIds: [...selectedPlaylists].sort(),
    clipIds: [...clipIds].sort(),
    streamIds: [...streamIds].sort(),
    requiredNodeIds: [...requiredNodes].sort(),
    routes,
    unknown,
    complete: unknown.length === 0 && !budgetExhausted,
    explored,
  };
}
