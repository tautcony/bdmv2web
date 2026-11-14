import type { MovieObject, ParsedDisc } from "@bdmv2web/bdmv-parser";
import { decodeInstruction, disassemble } from "../bytecode/decode.js";
import { buildNavigationGraph, type NavigationGraph } from "../graph/graph.js";
import type { VmProgram } from "../virtual-machine/vm.js";

/** One HDMV command as shown inside a block. */
export interface BlockCommand { pc: number; text: string; opcode: string | null; status: "known" | "invalid" | "unknown"; }

/** A maximal run of commands with no internal control-flow join or split. */
export interface ProgramBlock {
  id: string;
  startPc: number;
  commandCount: number;
  /** First and last opcode of the run, e.g. `MOVE → JUMP_TITLE`. */
  summary: string;
  commands: BlockCommand[];
}

/** A control-flow edge between blocks, playlists, external objects, or unknown destinations. */
export interface ProgramBlockEdge {
  fromBlock: string;
  fromPc: number;
  kind: string;
  condition: string | null;
  resolution: "resolved" | "unresolved";
  /** Block id inside this program, when the target command belongs to it. */
  toBlock: string | null;
  /** `playlist:00012`-style media target, when the edge plays a playlist. */
  toPlaylist: string | null;
  /** `object:15`-style reference, when the edge enters another program. */
  toObject: string | null;
}

export interface ProgramBlocks {
  blocks: ProgramBlock[];
  edges: ProgramBlockEdge[];
  /** The navigation graph the partition derives from (merged when provided). */
  graph: NavigationGraph;
  /** Block that holds PC 0; null when the program has no decodable first command. */
  entryBlock: string | null;
  /** Ids not reachable from the entry block through block edges. */
  unreachableBlocks: string[];
}

const COMMAND_RE = /^command:(\d+):(\d+)$/;

/**
 * Partition one program into basic blocks. Boundaries come from the navigation
 * graph itself: every edge target starts a block and every command that leaves
 * a target or faults ends one, so the partition stays consistent with the graph
 * the closure walks. Pass the merged MovieObject/button graph to keep resolved
 * cross-program `CALL_TITLE`/`JUMP_TITLE` targets; without it the program is
 * walked standalone.
 */
export function partitionProgramBlocks(program: MovieObject | VmProgram, options: { graph?: NavigationGraph; entries?: ParsedDisc["entries"] } = {}): ProgramBlocks {
  const graph = options.graph ?? buildNavigationGraph([program], [], options.entries ? { entries: options.entries } : {});
  const prefix = `command:${program.id}:`;
  const instructionCount = program.instructions.length;

  const starts = new Set<number>([0]);
  for (const edge of graph.edges) {
    if (!edge.from.startsWith(prefix)) continue;
    const fromPc = Number(edge.from.slice(prefix.length));
    // A plain fall-through edge continues the block; every other leaving edge
    // (goto, jump, call, play, resume, conditional, fault) ends one, and every
    // non-fall-through target starts one.
    const isFallThrough = edge.kind === "sequence" && edge.condition === null;
    if (!isFallThrough && fromPc + 1 < instructionCount) starts.add(fromPc + 1);
    if (isFallThrough) continue;
    const match = edge.to === null ? undefined : COMMAND_RE.exec(edge.to);
    if (match && Number(match[1]) === program.id && Number(match[2]) < instructionCount) starts.add(Number(match[2]));
  }
  // Decode once for labels; the graph already decided the boundaries.
  const commands: BlockCommand[] = program.instructions.map((row, pc) => {
    try {
      const d = decodeInstruction(row);
      return { pc, text: disassemble(row), opcode: d.opcode, status: d.status === "invalid" ? "invalid" : d.opcode ? "known" : "unknown" };
    } catch {
      return { pc, text: "UNKNOWN", opcode: null, status: "unknown" };
    }
  });

  const sortedStarts = [...starts].filter((pc) => pc < instructionCount).sort((a, b) => a - b);
  const blocks: ProgramBlock[] = [];
  const commandToBlock = new Map<number, string>();
  sortedStarts.forEach((start, index) => {
    const end = index + 1 < sortedStarts.length ? sortedStarts[index + 1]! : instructionCount;
    const id = `b${start}`;
    for (let pc = start; pc < end; pc++) commandToBlock.set(pc, id);
    const blockCommands = commands.slice(start, end);
    const firstOpcode = blockCommands[0]?.opcode ?? "?";
    const lastOpcode = blockCommands[blockCommands.length - 1]?.opcode ?? "?";
    blocks.push({
      id, startPc: start, commandCount: blockCommands.length,
      summary: firstOpcode === lastOpcode ? firstOpcode : `${firstOpcode} → ${lastOpcode}`,
      commands: blockCommands,
    });
  });

  const edges: ProgramBlockEdge[] = [];
  for (const edge of graph.edges) {
    if (!edge.from.startsWith(prefix)) continue;
    const fromPc = Number(edge.from.slice(prefix.length));
    const fromBlock = commandToBlock.get(fromPc);
    if (fromBlock === undefined) continue;
    const parsed = edge.to === null ? undefined : COMMAND_RE.exec(edge.to);
    edges.push({
      fromBlock, fromPc, kind: edge.kind, condition: edge.condition, resolution: edge.resolution,
      toBlock: parsed && Number(parsed[1]) === program.id && commandToBlock.has(Number(parsed[2])) ? commandToBlock.get(Number(parsed[2]))! : null,
      toPlaylist: edge.to !== null && edge.to.startsWith("playlist:") ? edge.to : null,
      toObject: edge.to !== null && /^object:\d+$/.test(edge.to) ? edge.to : null,
    });
  }

  const entryBlock = commandToBlock.get(0) ?? null;
  const reachable = new Set<string>();
  if (entryBlock !== null) {
    const bySource = new Map<string, ProgramBlockEdge[]>();
    for (const edge of edges) if (edge.toBlock) bySource.set(edge.fromBlock, [...(bySource.get(edge.fromBlock) ?? []), edge]);
    const pending = [entryBlock];
    while (pending.length) {
      const id = pending.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const edge of bySource.get(id) ?? []) pending.push(edge.toBlock!);
    }
  }
  const unreachableBlocks = blocks.map((block) => block.id).filter((id) => !reachable.has(id));
  return { blocks, edges, graph, entryBlock, unreachableBlocks };
}

/** Classify the leaving edges of a block for diagram colouring. */
export function blockTerminatorKind(edges: ProgramBlockEdge[], blockId: string): "goto" | "jump" | "call" | "play" | "resume" | "conditional" | "fallthrough" | "unknown" {
  const leaving = edges.filter((edge) => edge.fromBlock === blockId);
  const kinds = new Set(leaving.map((edge) => edge.kind));
  if (kinds.has("conditional")) return "conditional";
  if (kinds.has("play")) return "play";
  if (kinds.has("call")) return "call";
  if (kinds.has("jump")) return "jump";
  if (kinds.has("resume")) return "resume";
  if (kinds.has("unknown")) return "unknown";
  return kinds.has("sequence") ? "fallthrough" : "goto";
}
