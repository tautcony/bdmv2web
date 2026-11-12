import type { MovieObject, ParsedDisc, SourceLocation } from "@bdmv2web/bdmv-parser";
import { decodeInstruction, type OpcodeName } from "../bytecode/decode.js";
import type { VmProgram } from "../virtual-machine/vm.js";

export interface NavigationGraphNode { id: string; kind: "object" | "command"; objectId: number; commandIndex?: number; source: SourceLocation | null; status: "known" | "unknown"; }
export interface NavigationGraphEdge { from: string; to: string | null; kind: "sequence" | "conditional" | "jump" | "call" | "resume" | "play" | "unknown"; condition: string | null; source: SourceLocation; resolution: "resolved" | "unresolved"; origin?: string; }
export interface NavigationGraph { nodes: NavigationGraphNode[]; edges: NavigationGraphEdge[]; explored: number; complete: boolean; diagnostics: string[]; }
export interface GraphOptions { maxStates?: number; entries?: ParsedDisc["entries"]; context?: "object" | "playlist"; }
const UNKNOWN_SOURCE: SourceLocation = { path: "<unknown-command>", origin: "primary", offset: "0" };

function terminatesFlow(opcode: OpcodeName | null | undefined, context: "object" | "playlist"): boolean {
  if (opcode === "JUMP_TITLE") return true;
  if (["LINK_PI", "LINK_MK", "TERMINATE_PL"].includes(opcode ?? "")) return context === "playlist";
  return ["GOTO", "BREAK", "JUMP_OBJECT", "CALL_OBJECT", "CALL_TITLE", "RESUME", "PLAY_PL", "PLAY_PL_PI", "PLAY_PL_PM"].includes(opcode ?? "");
}

export function buildNavigationGraph(objects: Array<MovieObject | VmProgram>, appendedPrograms: VmProgram[] = [], options: GraphOptions = {}): NavigationGraph {
  const all: Array<MovieObject | VmProgram> = [...objects, ...appendedPrograms]; const nodes: NavigationGraphNode[] = []; const edges: NavigationGraphEdge[] = []; const diagnostics: string[] = [];
  const byId = new Map<number, MovieObject | VmProgram>(); for (const p of all) byId.set(p.id, p);
  const context = options.context ?? "object";
  const maxStates = Math.max(0, options.maxStates ?? 50_000); let explored = 0; let complete = true;
  for (const p of all) {
    const program = p; const objectSource = "source" in program ? program.source : null;
    nodes.push({ id: `object:${p.id}`, kind: "object", objectId: p.id, source: objectSource, status: "known" });
    for (let index = 0; index < program.instructions.length; index++) {
      if (explored >= maxStates) {
        complete = false; diagnostics.push("VM_EXECUTION_LIMIT: graph state budget exhausted; unexplored states remain unknown");
        edges.push({ from: `object:${p.id}`, to: null, kind: "unknown", condition: `commands from ${index} onward not explored`, source: objectSource ?? UNKNOWN_SOURCE, resolution: "unresolved" });
        break;
      }
      explored++;
      const row = program.instructions[index]!; let d;
      try { d = decodeInstruction(row); } catch { diagnostics.push(`decode-failed:${p.id}:${index}`); }
      const id = `command:${p.id}:${index}`; const source = d?.source ?? (typeof row === "object" && !(row instanceof Uint8Array) && "source" in row ? row.source : UNKNOWN_SOURCE);
      nodes.push({ id, kind: "command", objectId: p.id, commandIndex: index, source: source ?? null, status: d?.opcode && d.status !== "invalid" ? "known" : "unknown" });
      if (d?.status === "invalid") {
        diagnostics.push(`invalid-command:${p.id}:${index}`);
        edges.push({ from: id, to: null, kind: "unknown", condition: "invalid encoding; execution faults", source, resolution: "unresolved" });
        continue;
      }
      if (d?.opcode === "GOTO") {
        const operand = d.operands[0]; const target = operand?.kind === "immediate" ? operand.value : null; const known = target !== null && target < program.instructions.length;
        edges.push({ from: id, to: known ? `command:${p.id}:${target}` : null, kind: "jump", condition: null, source, resolution: known ? "resolved" : "unresolved" });
      } else if (d?.opcode === "JUMP_OBJECT" || d?.opcode === "CALL_OBJECT") {
        const operand = d.operands[0]; const target = operand?.kind === "immediate" ? operand.value : null; const known = target !== null && byId.has(target);
        edges.push({ from: id, to: known ? `object:${target}` : null, kind: d.opcode === "CALL_OBJECT" ? "call" : "jump", condition: null, source, resolution: known ? "resolved" : "unresolved" });
        if (!known) diagnostics.push(`dynamic-or-missing-target:${p.id}:${index}`);
      } else if (["PLAY_PL", "PLAY_PL_PI", "PLAY_PL_PM"].includes(d?.opcode ?? "")) {
        const operand = d?.operands[0];
        const target = operand?.kind === "immediate" && operand.value <= 99999 ? `playlist:${String(operand.value).padStart(5, "0")}` : null;
        edges.push({ from: id, to: target, kind: "play", condition: null, source, resolution: target === null ? "unresolved" : "resolved" });
        if (index + 1 < program.instructions.length) edges.push({ from: id, to: `command:${p.id}:${index + 1}`, kind: "sequence", condition: "after playlist returns", source, resolution: "resolved" });
      } else if (d?.opcode === "JUMP_TITLE" || d?.opcode === "CALL_TITLE") {
        const operand = d.operands[0]; const title = operand?.kind === "immediate" ? operand.value : null;
        const entries = options.entries;
        const entry = title === 0 ? entries?.find((item) => item.kind === "topMenu")
          : title === 0xffff ? entries?.find((item) => item.kind === "firstPlay")
            : title !== null && title > 0 ? entries?.filter((item) => item.kind === "title")[title - 1] : undefined;
        const target = entry?.target.objectType === "HDMV" && typeof entry.target.target === "number" && byId.has(entry.target.target) ? entry.target.target : null;
        edges.push({ from: id, to: target === null ? null : `object:${target}`, kind: d.opcode === "CALL_TITLE" ? "call" : "jump", condition: null, source, resolution: target === null ? "unresolved" : "resolved" });
        if (d.opcode === "JUMP_TITLE" && target !== null) edges.push({ from: id, to: `object:${target}`, kind: "sequence", condition: null, source, resolution: "resolved", origin: "jump-title" });
        if (d.opcode === "CALL_TITLE" && index + 1 < program.instructions.length) edges.push({ from: id, to: `command:${p.id}:${index + 1}`, kind: "sequence", condition: "after title resumes", source, resolution: "resolved" });
      } else if (["LINK_PI", "LINK_MK"].includes(d?.opcode ?? "")) {
        edges.push({ from: id, to: null, kind: "play", condition: null, source, resolution: "unresolved" });
      } else if (d?.opcode === "RESUME") {
        edges.push({ from: id, to: null, kind: "resume", condition: "depends on dynamic call/resume context", source, resolution: "unresolved" });
      } else if (["EQ", "NE", "GE", "GT", "LE", "LT", "BC"].includes(d?.opcode ?? "")) {
        edges.push({ from: id, to: `command:${p.id}:${index + 1}`, kind: "conditional", condition: `${d?.opcode} predicate true; next command`, source, resolution: "unresolved" });
        edges.push({ from: id, to: `command:${p.id}:${index + 2}`, kind: "conditional", condition: `${d?.opcode} predicate false; skip next command`, source, resolution: "unresolved" });
      }
      if (!terminatesFlow(d?.opcode, context) && index + 1 < program.instructions.length) edges.push({ from: id, to: `command:${p.id}:${index + 1}`, kind: "sequence", condition: null, source, resolution: "resolved" });
      if (!d?.opcode) edges.push({ from: id, to: null, kind: "unknown", condition: "unknown encoding; execution faults", source, resolution: "unresolved" });
    }
    if (!complete) break;
  }
  return { nodes, edges, explored, complete, diagnostics };
}
