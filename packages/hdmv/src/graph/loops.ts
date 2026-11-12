import type { NavigationGraph } from "./graph.js";

export interface StaticNavigationLoop {
  backEdge: { from: string; to: string };
  cycle: string[];
  movieObjects: number[];
  commandLocations: Array<{ movieObject: number; pc: number }>;
}

/** Finds static potential loops in the command/object graph using DFS back edges. */
export function findStaticNavigationLoops(graph: NavigationGraph): StaticNavigationLoop[] {
  const nodes = new Set(graph.nodes.map((node) => node.id));
  const adjacency = new Map<string, string[]>();
  const add = (from: string, to: string) => {
    if (!nodes.has(from) || !nodes.has(to)) return;
    const targets = adjacency.get(from) ?? [];
    targets.push(to);
    adjacency.set(from, targets);
  };
  for (const node of graph.nodes) {
    if (node.kind !== "object") continue;
    if (nodes.has(`command:${node.objectId}:0`)) add(node.id, `command:${node.objectId}:0`);
  }
  for (const edge of graph.edges) if (edge.to && nodes.has(edge.to)) add(edge.from, edge.to);

  const color = new Map<string, 0 | 1 | 2>();
  const path: string[] = [];
  const loops: StaticNavigationLoop[] = [];
  for (const root of nodes) {
    if ((color.get(root) ?? 0) !== 0) continue;
    color.set(root, 1);
    path.push(root);
    const stack: Array<{ node: string; next: number; targets: string[] }> = [{ node: root, next: 0, targets: adjacency.get(root) ?? [] }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      if (frame.next >= frame.targets.length) {
        color.set(frame.node, 2);
        stack.pop();
        path.pop();
        continue;
      }
      const target = frame.targets[frame.next++]!;
      if ((color.get(target) ?? 0) === 0) {
        color.set(target, 1);
        path.push(target);
        stack.push({ node: target, next: 0, targets: adjacency.get(target) ?? [] });
      } else if (color.get(target) === 1) {
        const start = path.lastIndexOf(target);
        const cycle = [...path.slice(start), target];
        const locations = cycle.flatMap((id) => {
          const match = /^command:(\d+):(\d+)$/.exec(id);
          return match ? [{ movieObject: Number(match[1]), pc: Number(match[2]) }] : [];
        });
        loops.push({
          backEdge: { from: frame.node, to: target },
          cycle,
          movieObjects: [...new Set(locations.map((location) => location.movieObject))],
          commandLocations: locations,
        });
      }
    }
  }
  return loops;
}
