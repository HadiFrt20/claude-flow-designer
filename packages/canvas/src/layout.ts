// Deterministic auto-layout for a WorkflowGraph. Templates and freshly-imported
// sidecars often ship every node at {0,0} (positions are a UI concern the codegen
// doesn't own), so on load the nodes would stack at the origin. This assigns a
// left→right layered layout from the DAG: column = longest-path depth from a root,
// row = order within that column. Pure — no React/DOM. Used by the store on load.
import type { WorkflowGraph } from '@clauflow/core';
import { topoOrder } from '@clauflow/core';

const COL_W = 240; // horizontal gap between layers
const ROW_H = 120; // vertical gap between nodes in a layer
const X0 = 40;
const Y0 = 40;

/**
 * True when the graph's node positions are degenerate — two or more nodes share a
 * position (the {0,0} template case), or there are ≥2 nodes all at the origin. A
 * graph the user has already arranged (distinct positions) is left untouched.
 */
export function needsLayout(graph: WorkflowGraph): boolean {
  if (graph.nodes.length < 2) return false;
  const seen = new Set<string>();
  for (const n of graph.nodes) {
    const key = `${n.position.x},${n.position.y}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

/**
 * Return a copy of the graph with layered positions assigned. Column = longest
 * path (in edges) from any in-degree-0 node; within a column, nodes keep topo
 * order. Deterministic (topoOrder is stable), so layout never churns a diff.
 */
export function applyLayout(graph: WorkflowGraph): WorkflowGraph {
  const order = topoOrder(graph);
  const rank = new Map(order.map((id, i) => [id, i]));
  const incoming = new Map<string, string[]>();
  for (const n of graph.nodes) incoming.set(n.id, []);
  for (const e of graph.edges) incoming.get(e.target)?.push(e.source);

  // Longest-path depth from the roots, computed in topo order so predecessors
  // are always resolved first.
  const depth = new Map<string, number>();
  for (const id of order) {
    const preds = incoming.get(id) ?? [];
    const d = preds.length === 0 ? 0 : Math.max(...preds.map((p) => (depth.get(p) ?? 0) + 1));
    depth.set(id, d);
  }
  // Nodes with no edges at all (or unreachable) still get a depth of 0.
  for (const n of graph.nodes) if (!depth.has(n.id)) depth.set(n.id, 0);

  // Bucket by column, ordered within a column by topo rank for stability.
  const byCol = new Map<number, string[]>();
  for (const n of graph.nodes) {
    const c = depth.get(n.id) ?? 0;
    (byCol.get(c) ?? byCol.set(c, []).get(c)!).push(n.id);
  }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [col, ids] of byCol) {
    ids.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
    ids.forEach((id, row) => {
      pos.set(id, { x: X0 + col * COL_W, y: Y0 + row * ROW_H });
    });
  }

  // M9: cluster phase members inside their phase's container. The layered layout
  // above spreads members across columns by depth; that would make a phase's
  // bounding box overlap sibling phases. Re-place each phase's members in a compact
  // block offset to the right of and below the phase node, stacked in topo order, so
  // the container box (derived from member positions in FlowCanvas) stays tight.
  const MEMBER_DX = 40; // inset of members from the phase's x
  const MEMBER_DY = 56; // first member below the phase title
  // Members stack vertically inside the phase; a fanout member is tall (its lanes),
  // so give the stack a roomier gap than the top-level ROW_H to keep the bottom→top
  // orthogonal edges from crowding.
  const MEMBER_ROW_H = 150;
  const byParent = new Map<string, string[]>();
  for (const n of graph.nodes) if (n.parentId) (byParent.get(n.parentId) ?? byParent.set(n.parentId, []).get(n.parentId)!).push(n.id);
  for (const [pid, members] of byParent) {
    const base = pos.get(pid);
    if (!base) continue;
    members.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
    members.forEach((id, i) => {
      pos.set(id, { x: base.x + MEMBER_DX, y: base.y + MEMBER_DY + i * MEMBER_ROW_H });
    });
  }

  return {
    ...graph,
    nodes: graph.nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })),
  };
}

/** Layout only if positions are degenerate; otherwise return the graph unchanged. */
export function layoutIfNeeded(graph: WorkflowGraph): WorkflowGraph {
  return needsLayout(graph) ? applyLayout(graph) : graph;
}
