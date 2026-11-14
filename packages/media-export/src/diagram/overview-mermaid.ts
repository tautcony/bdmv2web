import type { ParsedDisc } from "@bdmv2web/bdmv-parser";
import type { NavigationGraph } from "@bdmv2web/hdmv";
import { escapeMermaid } from "@bdmv2web/hdmv";
import type { MediaClosure } from "../closure.js";

export interface OverviewProgram {
  id: number;
  kind: "movie-object" | "button-program";
  label: string;
  instructionCount: number;
  /** Source stream for button programs, e.g. `00025`. */
  streamClipId?: string;
}

export interface OverviewDiagramInput {
  disc: Pick<ParsedDisc, "entries" | "playlists" | "movieObjects">;
  graph: NavigationGraph;
  programs: OverviewProgram[];
  closure?: MediaClosure;
  /** Above this count, button programs collapse into one node per source stream. */
  maxButtonNodes?: number;
}

const DEFAULT_MAX_BUTTON_NODES = 40;

/**
 * Render the disc-wide navigation overview as a mermaid flowchart: index
 * entries into programs, program call/jump/play relationships into playlists,
 * and one shared node for statically unresolved destinations. Button programs
 * group under their source stream; very large sets collapse into one summary
 * node per stream. Returns the mermaid source without code fences.
 */
export function renderOverviewMermaid(input: OverviewDiagramInput): string {
  const { disc, graph, programs, closure } = input;
  const maxButtonNodes = Math.max(1, input.maxButtonNodes ?? DEFAULT_MAX_BUTTON_NODES);
  const programById = new Map(programs.map((program) => [`object:${program.id}`, program]));

  const playTargets = new Map<string, Set<string>>();
  const objectTargets = new Map<string, Map<string, string>>();
  const unresolvedKinds = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    const sourceMatch = /^command:(\d+):/.exec(edge.from);
    if (!sourceMatch) continue;
    const sourceId = `object:${sourceMatch[1]}`;
    if (!programById.has(sourceId)) continue;
    if (edge.kind === "play" && edge.to?.startsWith("playlist:")) {
      const targets = playTargets.get(sourceId) ?? new Set<string>();
      targets.add(edge.to);
      playTargets.set(sourceId, targets);
    } else if ((edge.kind === "call" || edge.kind === "jump" || (edge.kind === "sequence" && edge.condition === null && edge.to?.startsWith("object:"))) && edge.to?.startsWith("object:") && programById.has(edge.to)) {
      const targets = objectTargets.get(sourceId) ?? new Map<string, string>();
      if (!targets.has(edge.to)) targets.set(edge.to, edge.kind === "sequence" ? "jump" : edge.kind);
      objectTargets.set(sourceId, targets);
    } else if (edge.to === null) {
      const kinds = unresolvedKinds.get(sourceId) ?? new Set<string>();
      kinds.add(edge.kind);
      unresolvedKinds.set(sourceId, kinds);
    }
  }

  const movieObjects = programs.filter((program) => program.kind === "movie-object");
  const buttons = programs.filter((program) => program.kind === "button-program");
  const collapsed = buttons.length > maxButtonNodes;
  const buttonNodes = collapsed
    ? [...new Set(buttons.map((program) => program.streamClipId ?? "unknown"))].map((clipId) => ({
        key: `stream:${clipId}`, label: `${clipId} · ${buttons.filter((program) => (program.streamClipId ?? "unknown") === clipId).length} buttons`,
        members: buttons.filter((program) => (program.streamClipId ?? "unknown") === clipId).map((program) => `object:${program.id}`),
      }))
    : buttons.map((program) => ({ key: `object:${program.id}`, label: program.label, members: [`object:${program.id}`] }));

  const lines: string[] = ["flowchart LR"];
  const hasBdjEntries = disc.entries.some((entry) => !(entry.target.objectType === "HDMV" && typeof entry.target.target === "number"));
  for (const entry of disc.entries) {
    const isHdmv = entry.target.objectType === "HDMV" && typeof entry.target.target === "number";
    const target = isHdmv ? `object:${entry.target.target}` : null;
    const id = nodeId(`entry:${entry.id}`);
    const suffix = isHdmv ? "" : "<br/>BD-J";
    lines.push(`  ${id}{{"${escapeMermaid(`${entry.kind} · ${entry.id}`)}${suffix}"}}`);
    if (target && programById.has(target)) lines.push(`  ${id} -->|entry| ${nodeId(target)}`);
    else if (target) lines.push(`  ${id} -.-> unknown`);
    else lines.push(`  ${id} --> bdj`);
  }
  for (const program of movieObjects) {
    lines.push(`  ${nodeId(`object:${program.id}`)}["${escapeMermaid(program.label)}<br/>${program.instructionCount} cmds"]`);
  }
  if (collapsed) {
    for (const group of buttonNodes) lines.push(`  ${nodeId(group.key)}["${escapeMermaid(`Buttons ${group.label}`)}"]`);
  } else if (buttonNodes.length) {
    const byStream = new Map<string, OverviewProgram[]>();
    for (const program of buttons) {
      const key = program.streamClipId ?? "unknown";
      byStream.set(key, [...(byStream.get(key) ?? []), program]);
    }
    for (const [stream, members] of byStream) {
      lines.push(`  subgraph stream_${stream}["${escapeMermaid(`Buttons · ${stream}`)}"]`);
      lines.push("    direction TB");
      for (const program of members) lines.push(`    ${nodeId(`object:${program.id}`)}["${escapeMermaid(program.label)}<br/>${program.instructionCount} cmds"]`);
      lines.push("  end");
    }
  }
  for (const playlist of disc.playlists) {
    lines.push(`  ${nodeId(`playlist:${playlist.id}`)}(["PL ${playlist.id}<br/>${playlist.playItems.length} item${playlist.playItems.length === 1 ? "" : "s"}"])`);
  }
  lines.push(`  unknown{{"dynamic / unresolved"}}`);
  if (hasBdjEntries) lines.push(`  bdj{{"BD-J entry target"}}`);

  const emitProgramEdges = (members: OverviewProgram[], sourceOf: (program: OverviewProgram) => string): void => {
    const play = new Map<string, Set<string>>();
    const objects = new Map<string, Map<string, Set<string>>>();
    const unresolved = new Set<string>();
    for (const program of members) {
      const id = `object:${program.id}`;
      const source = sourceOf(program);
      for (const target of playTargets.get(id) ?? []) play.set(target, (play.get(target) ?? new Set()).add(source));
      for (const [target, kind] of objectTargets.get(id) ?? []) {
        const bySource = objects.get(target) ?? new Map<string, Set<string>>();
        bySource.set(source, (bySource.get(source) ?? new Set()).add(kind));
        objects.set(target, bySource);
      }
      for (const kind of unresolvedKinds.get(id) ?? []) unresolved.add(kind);
    }
    for (const [target, sources] of play) {
      for (const source of sources) lines.push(`  ${source} -->|play| ${nodeId(target)}`);
    }
    for (const [target, bySource] of objects) {
      for (const [source, kinds] of bySource) lines.push(`  ${source} -->|${[...kinds].join("/")}| ${nodeId(target)}`);
    }
    if (unresolved.size && members.length) lines.push(`  ${sourceOf(members[0]!)} -.->|${[...unresolved].join("/")}| unknown`);
  };

  for (const program of movieObjects) emitProgramEdges([program], () => nodeId(`object:${program.id}`));
  for (const group of buttonNodes) {
    const members = collapsed
      ? buttons.filter((program) => group.members.includes(`object:${program.id}`))
      : buttons.filter((program) => group.members.includes(`object:${program.id}`));
    emitProgramEdges(members, collapsed ? () => nodeId(group.key) : (program) => nodeId(`object:${program.id}`));
  }

  lines.push(`  classDef entry fill:#2e1065,stroke:#a78bfa,color:#ede9fe;`);
  lines.push(`  classDef mobj fill:#0f2a43,stroke:#7dd3fc,color:#e0f2fe;`);
  lines.push(`  classDef button fill:#422006,stroke:#fbbf24,color:#fef3c7;`);
  lines.push(`  classDef playlist fill:#052e1b,stroke:#34d399,color:#d1fae5;`);
  lines.push(`  classDef unknown fill:#431407,stroke:#fb923c,color:#ffedd5,stroke-dasharray:5 3;`);
  const entryIds = disc.entries.map((entry) => nodeId(`entry:${entry.id}`));
  if (entryIds.length) lines.push(`  class ${entryIds.join(",")} entry;`);
  if (movieObjects.length) lines.push(`  class ${movieObjects.map((program) => nodeId(`object:${program.id}`)).join(",")} mobj;`);
  if (buttons.length && !collapsed) lines.push(`  class ${buttons.map((program) => nodeId(`object:${program.id}`)).join(",")} button;`);
  if (collapsed) lines.push(`  class ${buttonNodes.map((group) => nodeId(group.key)).join(",")} button;`);
  if (disc.playlists.length) lines.push(`  class ${disc.playlists.map((playlist) => nodeId(`playlist:${playlist.id}`)).join(",")} playlist;`);
  lines.push(`  class unknown unknown;`);
  lines.push(`  %% media closure: ${closure ? `${closure.complete ? "complete" : `incomplete, ${closure.unknown.length} unknown entr${closure.unknown.length === 1 ? "y" : "ies"}`}` : "not computed"}`);
  return lines.join("\n");
}

function nodeId(id: string): string {
  return `n_${Buffer.from(id).toString("hex")}`;
}
