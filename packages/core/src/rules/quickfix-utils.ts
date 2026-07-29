// Pure immutable graph transforms used by quick fixes. Every helper returns a
// new graph; the input is never mutated (quick fixes are tested like rules).
import type { WorkflowGraph } from '../schema/graph.js';
import type { WorkflowNode } from '../schema/nodes.js';

function clone(graph: WorkflowGraph): WorkflowGraph {
  return structuredClone(graph);
}

/** Replace one node (matched by id) with the result of `fn`. */
export function mapNode(
  graph: WorkflowGraph,
  nodeId: string,
  fn: (n: WorkflowNode) => WorkflowNode,
): WorkflowGraph {
  const g = clone(graph);
  g.nodes = g.nodes.map((n) => (n.id === nodeId ? fn(n) : n));
  return g;
}

/**
 * Patch the `data` of a node of a known kind. The callback receives the mutable
 * clone's data object and edits it in place.
 */
export function patchNodeData<K extends WorkflowNode['kind']>(
  graph: WorkflowGraph,
  nodeId: string,
  kind: K,
  patch: (data: Extract<WorkflowNode, { kind: K }>['data']) => void,
): WorkflowGraph {
  const g = clone(graph);
  const node = g.nodes.find((n) => n.id === nodeId);
  if (node && node.kind === kind) {
    // Runtime kind check guarantees the variant. TS can't correlate a generic K
    // against the discriminant across a distributive union, so widen the callback
    // to accept the erased data shape.
    (patch as (d: WorkflowNode['data']) => void)(node.data);
  }
  return g;
}

/** Remove a node and every edge that touches it. */
export function removeNode(graph: WorkflowGraph, nodeId: string): WorkflowGraph {
  const g = clone(graph);
  g.nodes = g.nodes.filter((n) => n.id !== nodeId);
  g.edges = g.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
  return g;
}

/** Append a node. */
export function addNode(graph: WorkflowGraph, node: WorkflowNode): WorkflowGraph {
  const g = clone(graph);
  g.nodes = [...g.nodes, node];
  return g;
}

/** Patch global settings. */
export function patchSettings(
  graph: WorkflowGraph,
  patch: (s: WorkflowGraph['settings']) => void,
): WorkflowGraph {
  const g = clone(graph);
  patch(g.settings);
  return g;
}

/** Deterministic fresh id given a prefix and the current graph. */
export function freshId(graph: WorkflowGraph, prefix: string): string {
  let i = 1;
  const ids = new Set(graph.nodes.map((n) => n.id));
  while (ids.has(`${prefix}-${i}`)) i++;
  return `${prefix}-${i}`;
}
