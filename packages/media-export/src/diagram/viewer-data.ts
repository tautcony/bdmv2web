import type { MovieObject, ParsedDisc } from "@bdmv2web/bdmv-parser";
import type { NavigationGraph, VmProgram } from "@bdmv2web/hdmv";
import { partitionProgramBlocks } from "@bdmv2web/hdmv";
import type { MediaClosure } from "../closure.js";

export interface ViewerProgramPayload {
  id: number;
  kind: "movie-object" | "button-program";
  label: string;
  instructionCount: number;
  streamClipId: string | null;
  entryBlock: string | null;
  blocks: ReturnType<typeof partitionProgramBlocks>["blocks"];
  edges: ReturnType<typeof partitionProgramBlocks>["edges"];
  unreachableBlocks: string[];
}

export interface ViewerPlaylistItem { clipId: string; streamPath: string; inTime90k: string; outTime90k: string; }
export interface ViewerPlaylistPayload {
  id: string;
  itemCount: number;
  items: ViewerPlaylistItem[];
  /** Provenance from the media closure: why this playlist is in the package. */
  routes: Array<{ origin: string; entryId: string | null; buttonProgramId: number | null }>;
}

export interface ViewerPayload {
  schemaVersion: "1.0";
  generatedFrom: string;
  counts: {
    entries: number; movieObjects: number; buttonPrograms: number; commands: number;
    blocks: number; playlists: number; unresolvedEdges: number;
  };
  entries: Array<{ id: string; kind: string; objectType: string; target: number | string | null }>;
  programs: ViewerProgramPayload[];
  playlists: ViewerPlaylistPayload[];
  mediaClosure: { complete: boolean; unknownCount: number; unknown: MediaClosure["unknown"] } | null;
}

export interface ViewerProgramSource {
  program: MovieObject | VmProgram;
  kind: "movie-object" | "button-program";
  label: string;
  streamClipId?: string;
}

export interface ViewerDataInput {
  disc: ParsedDisc;
  graph: NavigationGraph;
  sources: ViewerProgramSource[];
  closure?: MediaClosure;
  generatedFrom: string;
}

/**
 * Assemble the interactive viewer payload: per-program basic blocks with
 * disassembled commands, block-level edges resolved against the merged graph,
 * playlist media boundaries, and route provenance when a closure is available.
 * The result is JSON-serializable with no functions or class instances.
 */
export function createViewerPayload(input: ViewerDataInput): ViewerPayload {
  const { disc, graph, sources, closure, generatedFrom } = input;
  const programs: ViewerProgramPayload[] = sources.map((source) => {
    const partition = partitionProgramBlocks(source.program, { graph });
    return {
      id: source.program.id,
      kind: source.kind,
      label: source.label,
      instructionCount: source.program.instructions.length,
      streamClipId: source.streamClipId ?? null,
      entryBlock: partition.entryBlock,
      blocks: partition.blocks,
      edges: partition.edges,
      unreachableBlocks: partition.unreachableBlocks,
    };
  });

  const routeByPlaylist = new Map<string, MediaClosure["routes"]>();
  if (closure) {
    for (const route of closure.routes) {
      routeByPlaylist.set(route.playlistId, [...(routeByPlaylist.get(route.playlistId) ?? []), route]);
    }
  }
  const playlists: ViewerPlaylistPayload[] = disc.playlists.map((playlist) => ({
    id: playlist.id,
    itemCount: playlist.playItems.length,
    items: playlist.playItems.map((item) => ({
      clipId: item.clipId,
      streamPath: `STREAM/${item.clipId}.m2ts`,
      inTime90k: (BigInt(item.inTime45k) * 2n).toString(),
      outTime90k: (BigInt(item.outTime45k) * 2n).toString(),
    })),
    routes: (routeByPlaylist.get(`playlist:${playlist.id}`) ?? []).map((route) => ({ origin: route.origin, entryId: route.entryId, buttonProgramId: route.buttonProgramId })),
  }));

  const commands = programs.reduce((sum, program) => sum + program.instructionCount, 0);
  const blocks = programs.reduce((sum, program) => sum + program.blocks.length, 0);
  const unresolvedEdges = programs.reduce((sum, program) => sum + program.edges.filter((edge) => edge.toBlock === null && !edge.toPlaylist && !edge.toObject).length, 0);
  return {
    schemaVersion: "1.0",
    generatedFrom,
    counts: {
      entries: disc.entries.length,
      movieObjects: disc.movieObjects.length,
      buttonPrograms: programs.filter((program) => program.kind === "button-program").length,
      commands,
      blocks,
      playlists: disc.playlists.length,
      unresolvedEdges,
    },
    entries: disc.entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      objectType: entry.target.objectType,
      target: typeof entry.target.target === "number" ? entry.target.target : null,
    })),
    programs,
    playlists,
    mediaClosure: closure ? { complete: closure.complete, unknownCount: closure.unknown.length, unknown: closure.unknown } : null,
  };
}
