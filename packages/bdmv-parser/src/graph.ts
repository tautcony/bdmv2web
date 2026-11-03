import type { GraphEdge, GraphNode } from "./model.js";

export interface GraphTraversal {
  visited: string[];
  unresolvedEdges: GraphEdge[];
  missingNodes: string[];
  frontier: string[];
  complete: boolean;
}

/** Walk resolved references once per node, with a hard bound on visited nodes. */
export function traverseGraph(
  graph: { nodes: readonly GraphNode[]; edges: readonly GraphEdge[] },
  roots: readonly string[],
  maxNodes = 10_000,
): GraphTraversal {
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 0) throw new RangeError("maxNodes must be a non-negative safe integer");

  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgesBySource = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    const outgoing = edgesBySource.get(edge.from) ?? [];
    outgoing.push(edge);
    edgesBySource.set(edge.from, outgoing);
  }

  const visited: string[] = [];
  const visitedSet = new Set<string>();
  const unresolvedEdges: GraphEdge[] = [];
  const missingNodes: string[] = [];
  const missingSet = new Set<string>();
  const markMissing = (id: string) => {
    if (!missingSet.has(id)) { missingSet.add(id); missingNodes.push(id); }
  };
  const pending = [...roots].reverse();

  while (pending.length > 0 && visited.length < maxNodes) {
    const id = pending.pop()!;
    if (visitedSet.has(id)) continue;
    const node = nodes.get(id);
    if (!node || node.state === "missing") {
      markMissing(id);
      continue;
    }
    visitedSet.add(id);
    visited.push(id);

    for (const edge of edgesBySource.get(id) ?? []) {
      if (edge.resolution !== "resolved") {
        unresolvedEdges.push(edge);
        if (edge.resolution === "missing") markMissing(edge.to);
        continue;
      }
      if (!nodes.has(edge.to)) {
        unresolvedEdges.push(edge);
        markMissing(edge.to);
        continue;
      }
      if (!visitedSet.has(edge.to)) pending.push(edge.to);
    }
  }

  // De-duplicate the pending worklist while preserving order. This reports only
  // nodes left unexplored by the budget, not duplicates created by cycles.
  const frontier = [...new Set(pending.filter((id) => !visitedSet.has(id)))];
  return { visited, unresolvedEdges, missingNodes, frontier, complete: frontier.length === 0 && unresolvedEdges.length === 0 && missingNodes.length === 0 };
}
