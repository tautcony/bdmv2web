#!/usr/bin/env node
// Usage: node scripts/visualize-hdmv-vm-flow.mjs <BDMV-directory> <output.md>
// Example: node scripts/visualize-hdmv-vm-flow.mjs test-data/fixtures/hdmv-navigation/disc-data/kyoani-ova/BDMV /tmp/kyoani-flow.md
// Build the workspace packages first with `pnpm build`.
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseBdmv } from "../packages/bdmv-parser/dist/index.js";
import { buildNavigationGraph, decodeInstruction, disassemble, findStaticNavigationLoops } from "../packages/hdmv/dist/index.js";

const [inputArg, outputArg, ...extra] = process.argv.slice(2);
if (!inputArg || !outputArg || extra.length) {
  console.error("Usage: node scripts/visualize-hdmv-vm-flow.mjs <BDMV-directory> <output.md>");
  process.exitCode = 2;
} else {
  const disc = await parseBdmv(resolve(inputArg));
  const graph = buildNavigationGraph(disc.movieObjects, [], { entries: disc.entries, maxStates: 1_000_000 });
  const loops = findStaticNavigationLoops(graph);
  const loopEdges = new Set(loops.map(({ backEdge }) => `${backEdge.from}->${backEdge.to}`));
  const nodeNames = new Map();
  const unknownNodeIds = new Set();
  const loopStyleIndices = [];
  let edgeIndex = 0;
  const pushEdge = (line, isLoop = false) => {
    if (isLoop) loopStyleIndices.push(edgeIndex);
    lines.push(line);
    edgeIndex++;
  };
  const safeId = (id) => `n_${Buffer.from(id).toString("hex")}`;
  const node = (id, label, shape = "rect") => {
    const safe = nodeNames.get(id) ?? safeId(id);
    nodeNames.set(id, safe);
    const wrapped = shape === "round" ? `("${mermaid(label)}")` : shape === "diamond" ? `{{"${mermaid(label)}"}}` : `["${mermaid(label)}"]`;
    return `${safe}${wrapped}`;
  };
  const lines = ["flowchart LR", "  %% Generated from BDMV metadata; no STREAM/M2TS data is read."];
  const loopNodeIds = new Set(loops.flatMap((loop) => loop.cycle));
  const graphNodeIds = new Set(graph.nodes.map((item) => item.id));

  for (const entry of disc.entries) {
    const rootId = `entry:${entry.id}`;
    const target = entry.target.objectType === "HDMV" && typeof entry.target.target === "number" ? `object:${entry.target.target}` : `unknown-entry:${entry.id}`;
    lines.push(`  ${node(rootId, `${entry.kind} · ${entry.id}\n${entry.target.objectType}:${String(entry.target.target)}`, "diamond")}`);
    if (target.startsWith("unknown-entry:")) {
      unknownNodeIds.add(target);
      lines.push(`  ${node(target, "BD-J or unresolved entry\nunsupported", "diamond")}`);
    }
    pushEdge(`  ${nodeNames.get(rootId)} -->|index entry| ${nodeNames.get(target) ?? safeId(target)}`);
  }

  for (const program of disc.movieObjects) {
    const objectId = `object:${program.id}`;
    lines.push(`  subgraph sg_${program.id}["MovieObject ${program.id}"]`);
    lines.push("    direction TB");
    lines.push(`    ${node(objectId, `MOBJ ${program.id}`, "round")}`);
    for (let pc = 0; pc < program.instructions.length; pc++) {
      const id = `command:${program.id}:${pc}`;
      const decoded = decodeInstruction(program.instructions[pc]);
      const opcode = decoded.opcode ?? "UNKNOWN";
      const label = `PC ${pc} · ${opcode}\n${disassemble(program.instructions[pc])}`;
      lines.push(`    ${node(id, label)}`);
      if (pc === 0) pushEdge(`    ${nodeNames.get(objectId)} --> ${nodeNames.get(id)}`, loopEdges.has(`${objectId}->${id}`));
    }
    lines.push("  end");
  }

  for (const edge of graph.edges) {
    let target = edge.to;
    if (!target) {
      target = `unknown:${edge.from}:${edge.kind}`;
      unknownNodeIds.add(target);
      lines.push(`  ${node(target, `${edge.kind} target\nunknown / dynamic`, "diamond")}`);
    } else if (target.startsWith("playlist:")) {
      lines.push(`  ${node(target, `${target.slice(9)}\nplaylist / media wait`, "round")}`);
    } else if (!graphNodeIds.has(target)) {
      unknownNodeIds.add(target);
      lines.push(`  ${node(target, `${edge.kind} target\nunknown`, "diamond")}`);
    }
    const label = edge.condition?.includes("after title resumes")
      ? "possible return after RESUME; unconfirmed"
      : [edge.kind, edge.condition].filter(Boolean).join(" · ");
    const from = nodeNames.get(edge.from) ?? safeId(edge.from);
    const to = nodeNames.get(target) ?? safeId(target);
    const isLoop = loopEdges.has(`${edge.from}->${edge.to}`);
    const uncertain = edge.resolution === "unresolved" || edge.condition?.includes("after title resumes");
    const line = uncertain
      ? `  ${from} -. "${mermaid(label)}" .-> ${to}`
      : `  ${from} -->|${mermaid(label)}| ${to}`;
    pushEdge(line, isLoop);
  }

  for (const edge of graph.edges) {
    if (edge.kind !== "call" || !edge.from.startsWith("command:")) continue;
    const [, objectText, pcText] = edge.from.split(":");
    const returnId = `command:${objectText}:${Number(pcText) + 1}`;
    if (graphNodeIds.has(returnId)) pushEdge(`  ${nodeNames.get(edge.from)} -. "possible return after RESUME; unconfirmed" .-> ${nodeNames.get(returnId)}`);
  }

  lines.push(`  ${node("legend:flow", "Legend: RESUME destination depends on call context; dynamic VM targets stay unknown.", "round")}`);
  lines.push("  classDef staticLoop fill:#fee2e2,stroke:#dc2626,stroke-width:2px,color:#7f1d1d;");
  lines.push("  classDef unknown fill:#ffedd5,stroke:#ea580c,stroke-dasharray:5 3;");
  const loopNames = [...loopNodeIds].map((id) => nodeNames.get(id)).filter(Boolean);
  if (loopNames.length) lines.push(`  class ${loopNames.join(",")} staticLoop;`);
  const unknownNames = [...unknownNodeIds].map((id) => nodeNames.get(id)).filter(Boolean);
  if (unknownNames.length) lines.push(`  class ${unknownNames.join(",")} unknown;`);
  if (loopStyleIndices.length) lines.push(`  linkStyle ${loopStyleIndices.join(",")} stroke:#dc2626,stroke-width:3px;`);
  lines.push("  %% Static potential loop back-edges (not evidence of runtime loops):");
  for (const loop of loops) lines.push(`  %% ${loop.backEdge.from} -> ${loop.backEdge.to}; ${loop.commandLocations.map(({ movieObject, pc }) => `MOBJ ${movieObject} PC ${pc}`).join(" -> ")}`);

  const outputPath = resolve(outputArg);
  await writeFile(outputPath, `\`\`\`mermaid\n${lines.join("\n")}\n\`\`\`\n`, "utf8");
  console.log(JSON.stringify({ input: inputArg, output: outputPath, entries: disc.entries.length, movieObjects: disc.movieObjects.length, commands: graph.nodes.filter((item) => item.kind === "command").length, edges: graph.edges.length, staticLoops: loops.length, graphComplete: graph.complete }));
}

function mermaid(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "#quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("|", "&#124;").replaceAll("\n", "<br/>");
}
