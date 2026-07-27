// Pure graph-traversal helpers shared by validation rules and (later) codegen.
import type { WorkflowGraph, Edge } from './graph.js';
import type { NodeKind, WorkflowNode } from './nodes.js';
import type { HookEvent } from './types.js';

const TRIGGER_KINDS: ReadonlySet<NodeKind> = new Set([
  'trigger.slashCommand', 'trigger.hookEvent', 'trigger.sessionStart', 'trigger.headless',
]);

export function isTrigger(node: WorkflowNode): boolean {
  return TRIGGER_KINDS.has(node.kind);
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

/**
 * Walk backward from a node to the nearest `trigger.hookEvent` and return its
 * event, if any. Used by hook rules (a handler/decision is bound to whatever
 * hook-event trigger feeds it, possibly through a gate.condition).
 */
export function governingHookEvent(
  graph: WorkflowGraph,
  nodeId: string,
): HookEvent | undefined {
  const byId = nodeById(graph);
  const seen = new Set<string>();
  const stack = [...predecessors(graph, nodeId)];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (n?.kind === 'trigger.hookEvent') return n.data.event;
    stack.push(...predecessors(graph, id));
  }
  return undefined;
}

/** Set of node ids reachable from any trigger (forward traversal over edges). */
export function reachableFromTriggers(graph: WorkflowGraph): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
  }
  const seen = new Set<string>();
  const stack = graph.nodes.filter(isTrigger).map((n) => n.id);
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
