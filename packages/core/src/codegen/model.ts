// Turn a WorkflowGraph into codegen-ready structures for the workflow-script
// emitter: deterministic binding names (node id → const name) and the linearized
// statement order. SPEC-CODEGEN "Linearization". Pure, no I/O.
import type { WorkflowGraph } from '../schema/graph.js';
import type { NodeKind, WorkflowNode } from '../schema/nodes.js';
import { nodeById, topoOrder } from '../schema/graph-utils.js';

/** Kinds that produce a `const` binding (referenceable downstream). */
const BINDING_KINDS: ReadonlySet<NodeKind> = new Set([
  'agent', 'pipeline', 'loopUntilCheck',
]);

export function producesBinding(node: WorkflowNode): boolean {
  return BINDING_KINDS.has(node.kind);
}

function camelCase(s: string): string {
  const parts = s.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length === 0) return '';
  return parts
    .map((p, i) => (i === 0 ? p[0]!.toLowerCase() + p.slice(1) : p[0]!.toUpperCase() + p.slice(1)))
    .join('');
}

function sanitizeIdentifier(s: string): string {
  let out = s.replace(/[^A-Za-z0-9_$]/g, '');
  if (out === '' || !/^[A-Za-z_$]/.test(out)) out = '_' + out;
  return out;
}

function baseName(node: WorkflowNode): string {
  const label = node.label?.trim();
  const dataName = node.kind === 'workflow.meta' ? node.data.name : undefined;
  return sanitizeIdentifier(camelCase(label || dataName || node.kind.replace('.', '_')));
}

/**
 * Deterministic node id → JS binding name for every binding-producing node.
 * Names are derived from labels (stable topo order drives collision suffixes),
 * so the graph stays rename-stable and output is snapshot-stable.
 */
export function bindingNames(graph: WorkflowGraph): Map<string, string> {
  const order = topoOrder(graph);
  const byId = nodeById(graph);
  const used = new Set<string>();
  const names = new Map<string, string>();
  order.forEach((id, index) => {
    const node = byId.get(id);
    if (!node || !producesBinding(node)) return;
    let name = baseName(node) || `step${index}`;
    if (used.has(name)) name = `${name}_${index}`;
    used.add(name);
    names.set(id, name);
  });
  return names;
}

export interface LinearNode {
  node: WorkflowNode;
  binding?: string; // present for binding-producing kinds
}

/** Nodes in deterministic execution order, each with its binding (if any). */
export function linearize(graph: WorkflowGraph): LinearNode[] {
  const names = bindingNames(graph);
  const byId = nodeById(graph);
  return topoOrder(graph)
    .map((id) => byId.get(id))
    .filter((n): n is WorkflowNode => n !== undefined)
    .map((node) => ({ node, binding: names.get(node.id) }));
}
