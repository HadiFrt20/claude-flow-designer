// Pure graph-traversal helpers shared by validation rules and codegen.
import type { WorkflowGraph, Edge } from './graph.js';
import type { NodeKind, WorkflowNode } from './nodes.js';

/** The workflow.meta node is the unique DAG root (entry point). */
export function isRoot(node: WorkflowNode): boolean {
  return node.kind === 'workflow.meta';
}

export function nodeById(graph: WorkflowGraph): Map<string, WorkflowNode> {
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

/** Nodes of a specific kind (narrowed). */
export function nodesOfKind<K extends NodeKind>(
  graph: WorkflowGraph,
  kind: K,
): Extract<WorkflowNode, { kind: K }>[] {
  return graph.nodes.filter((n): n is Extract<WorkflowNode, { kind: K }> => n.kind === kind);
}

/** Outgoing edges from a node. */
export function outgoing(graph: WorkflowGraph, nodeId: string): Edge[] {
  return graph.edges.filter((e) => e.source === nodeId);
}

/** Incoming edges to a node. */
export function incoming(graph: WorkflowGraph, nodeId: string): Edge[] {
  return graph.edges.filter((e) => e.target === nodeId);
}

/** Direct successor node ids. */
export function successors(graph: WorkflowGraph, nodeId: string): string[] {
  return outgoing(graph, nodeId).map((e) => e.target);
}

/** Direct predecessor node ids. */
export function predecessors(graph: WorkflowGraph, nodeId: string): string[] {
  return incoming(graph, nodeId).map((e) => e.source);
}

/** Set of node ids reachable from the workflow.meta root (forward over edges). */
export function reachableFromRoot(graph: WorkflowGraph): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
  }
  const seen = new Set<string>();
  const stack = graph.nodes.filter(isRoot).map((n) => n.id);
  for (const id of stack) seen.add(id);
  while (stack.length) {
    const id = stack.pop()!;
    for (const next of adj.get(id) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}

/**
 * Detect a directed cycle over the edge set, restricted to `kinds` if given.
 * Returns the node ids participating in the first cycle found, else null.
 */
export function findCycle(graph: WorkflowGraph, kinds?: ReadonlySet<NodeKind>): string[] | null {
  const byId = nodeById(graph);
  const included = (id: string): boolean => {
    const n = byId.get(id);
    return n !== undefined && (!kinds || kinds.has(n.kind));
  };
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!included(e.source) || !included(e.target)) continue;
    (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string>();

  const walk = (start: string): string[] | null => {
    // Iterative DFS to stay safe on large graphs.
    const stack: Array<{ id: string; iter: Iterator<string> }> = [];
    color.set(start, GRAY);
    stack.push({ id: start, iter: (adj.get(start) ?? [])[Symbol.iterator]() });
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const next = top.iter.next();
      if (next.done) {
        color.set(top.id, BLACK);
        stack.pop();
        continue;
      }
      const child = next.value;
      const c = color.get(child) ?? WHITE;
      if (c === GRAY) {
        // Found a back-edge child -> ... -> top.id. Reconstruct the cycle.
        const cycle = [child];
        let cur = top.id;
        while (cur !== child) {
          cycle.push(cur);
          cur = parent.get(cur)!;
        }
        cycle.push(child);
        cycle.reverse();
        return cycle;
      }
      if (c === WHITE) {
        color.set(child, GRAY);
        parent.set(child, top.id);
        stack.push({ id: child, iter: (adj.get(child) ?? [])[Symbol.iterator]() });
      }
    }
    return null;
  };

  for (const n of graph.nodes) {
    if (!included(n.id)) continue;
    if ((color.get(n.id) ?? WHITE) === WHITE) {
      const cycle = walk(n.id);
      if (cycle) return cycle;
    }
  }
  return null;
}

/**
 * Deterministic topological order of the nodes (Kahn's algorithm). Ties among
 * ready (in-degree 0) nodes are broken by the position of the node's earliest
 * incoming edge in `graph.edges`, then by node id — the same stable ordering
 * `codegen/model.ts` uses for successors. Returns node ids in execution order.
 * Assumes the graph is acyclic (callers run findCycle first / CF003).
 */
export function topoOrder(graph: WorkflowGraph): string[] {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of graph.edges) {
    if (!indeg.has(e.source) || !indeg.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  // Earliest incoming-edge index per node, for the stable tiebreak.
  const firstEdgeIndex = new Map<string, number>();
  graph.edges.forEach((e, i) => {
    if (!firstEdgeIndex.has(e.target)) firstEdgeIndex.set(e.target, i);
  });
  const rank = (id: string): [number, string] => [firstEdgeIndex.get(id) ?? -1, id];
  const ready = graph.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  const cmp = (a: string, b: string): number => {
    const [ra, ia] = rank(a);
    const [rb, ib] = rank(b);
    return ra !== rb ? ra - rb : ia < ib ? -1 : ia > ib ? 1 : 0;
  };
  while (ready.length) {
    ready.sort(cmp);
    const id = ready.shift()!;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      const d = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, d);
      if (d === 0) ready.push(next);
    }
  }
  return order;
}
