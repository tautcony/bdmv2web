import type { MovieObject, ParsedDisc } from "@bdmv2web/bdmv-parser";
import { findStaticNavigationLoops } from "../graph/loops.js";
import type { VmProgram } from "../virtual-machine/vm.js";
import { partitionProgramBlocks, type ProgramBlockEdge, type ProgramBlocks } from "./program-blocks.js";

export interface ProgramFlowchartOptions {
  /** Merged graph holding this program; defaults to a standalone walk. */
  graph?: ProgramBlocks["graph"];
  entries?: ParsedDisc["entries"];
  /** Human label shown on the entry block, e.g. `MOBJ 0` or `Button 1000005`. */
  label?: string;
  /** Safety valve for very large programs; extra blocks collapse into one note. */
  maxBlocks?: number;
}

const DEFAULT_MAX_BLOCKS = 400;

/**
 * Render one program's control flow as a mermaid flowchart. Commands collapse
 * into basic blocks, media targets appear as playlist nodes, resolved
 * cross-program entries appear as object nodes, and unresolved destinations
 * share one dashed node. Returns the mermaid source without code fences.
 */
export function renderProgramFlowchart(program: MovieObject | VmProgram, options: ProgramFlowchartOptions = {}): string {
  const partition = partitionProgramBlocks(program, {
    ...(options.graph ? { graph: options.graph } : {}),
    ...(options.entries ? { entries: options.entries } : {}),
  });
  const { blocks, edges, entryBlock, unreachableBlocks } = partition;
  const maxBlocks = Math.max(1, options.maxBlocks ?? DEFAULT_MAX_BLOCKS);
  const label = options.label ?? `Program ${program.id}`;

  const drawn = new Set<string>();
  const overflow = new Set<string>();
  if (entryBlock !== null) {
    const bySource = new Map<string, ProgramBlockEdge[]>();
    for (const edge of edges) if (edge.toBlock) bySource.set(edge.fromBlock, [...(bySource.get(edge.fromBlock) ?? []), edge]);
    const pending = [entryBlock];
    while (pending.length) {
      const id = pending.pop()!;
      if (drawn.has(id)) continue;
      if (drawn.size >= maxBlocks) { overflow.add(id); continue; }
      drawn.add(id);
      for (const edge of bySource.get(id) ?? []) pending.push(edge.toBlock!);
    }
  }
  for (const block of blocks) if (!drawn.has(block.id) && !unreachableBlocks.includes(block.id)) overflow.add(block.id);

  const unknownTargets = edges.some((edge) => drawn.has(edge.fromBlock) && edge.toBlock === null && !edge.toPlaylist && !edge.toObject);
  const objectIds = new Set<string>();
  const playlistIds = new Set<string>();
  for (const edge of edges) {
    if (!drawn.has(edge.fromBlock)) continue;
    if (edge.toPlaylist) playlistIds.add(edge.toPlaylist);
    if (edge.toObject) objectIds.add(edge.toObject);
  }

  const lines: string[] = ["flowchart TB"];
  for (const block of blocks) {
    if (!drawn.has(block.id)) continue;
    const end = block.startPc + block.commandCount - 1;
    const range = block.startPc === end ? `PC ${block.startPc}` : `PC ${block.startPc}–${end}`;
    const entryTag = block.id === entryBlock ? `<br/>▶ ${escapeMermaid(label)}` : "";
    lines.push(`  ${nodeId(block.id)}["${block.id} · ${range} · ${block.commandCount} cmd${block.commandCount === 1 ? "" : "s"}<br/>${escapeMermaid(block.summary)}${entryTag}"]`);
  }
  for (const id of unreachableBlocks) {
    const block = blocks.find((item) => item.id === id)!;
    lines.push(`  ${nodeId(id)}["${block.id} · unreachable<br/>${escapeMermaid(block.summary)}"]`);
  }
  if (overflow.size) lines.push(`  overflow["… ${overflow.size} block${overflow.size === 1 ? "" : "s"} not drawn<br/>raise maxBlocks to include them"]`);
  if (entryBlock === null) lines.push(`  empty["${escapeMermaid(`${label} · no decodable commands`)}"]`);
  for (const playlist of playlistIds) lines.push(`  ${nodeId(playlist)}(["${escapeMermaid(playlist.slice("playlist:".length))}<br/>playlist"])`);
  for (const object of objectIds) lines.push(`  ${nodeId(object)}(["${escapeMermaid(object)}"])`);
  if (unknownTargets) lines.push(`  unknown{{"dynamic target<br/>unknown"}}`);

  const backPairs = loopBackPairs(partition);
  const seenEdges = new Set<string>();
  const unresolvedEdgeIndices: number[] = [];
  const loopEdgeIndices: number[] = [];
  let edgeIndex = 0;
  for (const edge of edges) {
    if (!drawn.has(edge.fromBlock)) continue;
    // Flow inside one block is the block itself; repeated identical block
    // edges (one per source command) collapse to their first instance.
    const isInternalFall = edge.kind === "sequence" && edge.condition === null && edge.toBlock === edge.fromBlock;
    if (isInternalFall) continue;
    const edgeKey = `${edge.fromBlock}>${edge.toBlock ?? ""}>${edge.toPlaylist ?? ""}>${edge.toObject ?? ""}>${edge.kind}>${edge.condition ?? ""}`;
    if (!seenEdges.has(edgeKey)) seenEdges.add(edgeKey); else continue;
    const hasTarget = edge.toBlock !== null || edge.toPlaylist !== null || edge.toObject !== null;
    const target = edge.toBlock !== null ? nodeId(edge.toBlock) : edge.toPlaylist ? nodeId(edge.toPlaylist) : edge.toObject ? nodeId(edge.toObject) : "unknown";
    const line = hasTarget
      ? `  ${nodeId(edge.fromBlock)} -->|${escapeMermaid(edgeLabel(edge))}| ${target}`
      : `  ${nodeId(edge.fromBlock)} -. "${escapeMermaid(edgeLabel(edge))}" .-> unknown`;
    lines.push(line);
    if (!hasTarget) unresolvedEdgeIndices.push(edgeIndex);
    if (edge.toBlock !== null && backPairs.has(`${edge.fromBlock}>${edge.toBlock}`)) loopEdgeIndices.push(edgeIndex);
    edgeIndex++;
  }

  lines.push(`  classDef block fill:#0f2a43,stroke:#7dd3fc,color:#e0f2fe;`);
  lines.push(`  classDef playlist fill:#052e1b,stroke:#34d399,color:#d1fae5;`);
  lines.push(`  classDef object fill:#1e1b4b,stroke:#a78bfa,color:#ede9fe;`);
  lines.push(`  classDef unknown fill:#431407,stroke:#fb923c,color:#ffedd5,stroke-dasharray:5 3;`);
  lines.push(`  classDef overflow fill:#1f2937,stroke:#6b7280,color:#9ca3af,stroke-dasharray:2 2;`);
  const drawnBlockIds = blocks.filter((item) => drawn.has(item.id) || unreachableBlocks.includes(item.id)).map((item) => nodeId(item.id));
  if (drawnBlockIds.length) lines.push(`  class ${drawnBlockIds.join(",")} block;`);
  if (playlistIds.size) lines.push(`  class ${[...playlistIds].map(nodeId).join(",")} playlist;`);
  if (objectIds.size) lines.push(`  class ${[...objectIds].map(nodeId).join(",")} object;`);
  if (unknownTargets) lines.push(`  class unknown unknown;`);
  if (overflow.size) lines.push(`  class overflow overflow;`);
  if (unresolvedEdgeIndices.length) lines.push(`  linkStyle ${unresolvedEdgeIndices.join(",")} stroke:#fb923c,stroke-dasharray:6 4;`);
  if (loopEdgeIndices.length) lines.push(`  linkStyle ${loopEdgeIndices.join(",")} stroke:#f87171,stroke-width:3px;`);
  return lines.join("\n");
}

/** Map DFS back edges from the command graph onto the block pairs they leave. */
function loopBackPairs(partition: ProgramBlocks): Set<string> {
  const backEdges = findStaticNavigationLoops(partition.graph);
  if (!backEdges.length) return new Set();
  const blockAt = new Map<number, string>();
  for (const block of partition.blocks) {
    for (let pc = block.startPc; pc < block.startPc + block.commandCount; pc++) blockAt.set(pc, block.id);
  }
  const blockOf = (commandId: string): string | null => {
    const match = /^command:\d+:(\d+)$/.exec(commandId);
    return match ? blockAt.get(Number(match[1])) ?? null : null;
  };
  const pairs = new Set<string>();
  for (const loop of backEdges) {
    const from = blockOf(loop.backEdge.from);
    const to = blockOf(loop.backEdge.to);
    if (from && to) pairs.add(`${from}>${to}`);
  }
  return pairs;
}

function nodeId(id: string): string {
  return `n_${Buffer.from(id).toString("hex")}`;
}

function edgeLabel(edge: ProgramBlockEdge): string {
  const direction = edge.condition?.includes("true") ? "T" : edge.condition?.includes("false") ? "F" : null;
  if (edge.kind === "sequence") return direction ?? edge.condition ?? "seq";
  if (direction) return `${edge.kind} ${direction}`;
  return edge.condition ? `${edge.kind} · ${edge.condition}` : edge.kind;
}

export function escapeMermaid(value: string): string {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "#quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("|", "&#124;").replaceAll("\n", "<br/>");
}
