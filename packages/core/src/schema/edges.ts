// Single source of truth for edge compatibility between node kinds (SPEC-NODES
// DAG semantics). Used by CF005 (validation) AND the canvas (to reject invalid
// drag-connections up front), so the two can never disagree.
//
// M6: edges are data + execution-order dependencies in a workflow DAG. The
// `workflow.meta` root is source-only; `output.return` is a sink; every other
// kind may chain to any producing/control kind.
import type { NodeKind } from './nodes.js';

/** May an edge connect a `source` node to a `target` node? */
export function edgeAllowed(source: NodeKind, target: NodeKind): boolean {
  // Nothing targets the root; the return sink has no outgoing edges.
  if (target === 'workflow.meta') return false;
  if (source === 'output.return') return false;
  // meta, agent, pipeline, branch, loopUntilCheck may all feed any non-root kind.
  return true;
}
