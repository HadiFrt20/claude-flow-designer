// Graph-structure rules CF001–CF008. See docs/SPEC-VALIDATION.md ("Graph structure").
// Generic DAG checks, retargeted for the workflow model (root = workflow.meta).
import type { Diagnostic, Rule } from '../diagnostics.js';
import type { WorkflowGraph } from '../schema/graph.js';
import { findCycle, isRoot, nodesOfKind, reachableFromRoot } from '../schema/graph-utils.js';
import { edgeAllowed } from '../schema/edges.js';
import { addNode, freshId, patchNodeData, removeNode } from './quickfix-utils.js';
import { DOCS_URLS } from './helpers.js';

const BUNDLED_COMMANDS = new Set(['deep-research', 'workflows']);

const cf001: Rule = {
  id: 'CF001',
  severity: 'error',
  run(graph) {
    if (graph.nodes.length === 0) return [];
    if (graph.nodes.some(isRoot)) return [];
    return [
      {
        ruleId: 'CF001',
        severity: 'error',
        message: 'Workflow has no entry point (add a workflow.meta node).',
        docsUrl: DOCS_URLS.workflows,
        quickFix: {
          title: 'Insert a workflow.meta node',
          apply: (g: WorkflowGraph) =>
            addNode(g, {
              id: freshId(g, 'meta'),
              kind: 'workflow.meta',
              label: 'Workflow',
              position: { x: 0, y: 0 },
              data: { name: g.meta.slug || 'workflow', description: '' },
            }),
        },
      },
    ];
  },
};

const cf002: Rule = {
  id: 'CF002',
  severity: 'error',
  run(graph) {
    const metas = nodesOfKind(graph, 'workflow.meta');
    if (metas.length <= 1) return [];
    return metas.slice(1).map(
      (n): Diagnostic => ({
        ruleId: 'CF002',
        severity: 'error',
        nodeId: n.id,
        message: `More than one workflow.meta node (found ${metas.length}).`,
        docsUrl: DOCS_URLS.workflows,
      }),
    );
  },
};

const cf003: Rule = {
  id: 'CF003',
  severity: 'error',
  run(graph) {
    const cycle = findCycle(graph);
    if (!cycle) return [];
    return [
      {
        ruleId: 'CF003',
        severity: 'error',
        nodeId: cycle[0],
        message: `Cycle in the workflow DAG: ${cycle.join(' → ')} (use a loopUntilCheck node, not an edge loop).`,
        docsUrl: DOCS_URLS.workflows,
      },
    ];
  },
};

const cf004: Rule = {
  id: 'CF004',
  severity: 'error',
  run(graph) {
    if (graph.nodes.length === 0 || !graph.nodes.some(isRoot)) return [];
    const reachable = reachableFromRoot(graph);
    return graph.nodes
      .filter((n) => !reachable.has(n.id))
      .map(
        (n): Diagnostic => ({
          ruleId: 'CF004',
          severity: 'error',
          nodeId: n.id,
          message: `Orphan node "${n.label}" — no path from workflow.meta.`,
          quickFix: { title: 'Delete orphan node', apply: (g: WorkflowGraph) => removeNode(g, n.id) },
        }),
      );
  },
};

const cf005: Rule = {
  id: 'CF005',
  severity: 'error',
  run(graph) {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const diags: Diagnostic[] = [];
    for (const e of graph.edges) {
      const s = byId.get(e.source);
      const t = byId.get(e.target);
      if (!s || !t) continue;
      if (!edgeAllowed(s.kind, t.kind)) {
        diags.push({
          ruleId: 'CF005',
          severity: 'error',
          nodeId: t.id,
          message: `Edge connects incompatible kinds: ${s.kind} → ${t.kind}.`,
          docsUrl: DOCS_URLS.workflows,
        });
      }
    }
    return diags;
  },
};

const cf006: Rule = {
  id: 'CF006',
  severity: 'warn',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const n of graph.nodes) {
      if (!n.label || n.label.trim() === '') {
        diags.push({ ruleId: 'CF006', severity: 'warn', nodeId: n.id, field: 'label', message: 'Node has an empty label.' });
      }
      if (n.kind === 'workflow.meta' && !n.data.description.trim()) {
        diags.push({ ruleId: 'CF006', severity: 'warn', nodeId: n.id, field: 'description', message: 'Workflow has an empty description.' });
      }
    }
    return diags;
  },
};

const cf008: Rule = {
  id: 'CF008',
  severity: 'warn',
  run(graph) {
    return nodesOfKind(graph, 'workflow.meta')
      .filter((n) => BUNDLED_COMMANDS.has(n.data.name))
      .map(
        (n): Diagnostic => ({
          ruleId: 'CF008',
          severity: 'warn',
          nodeId: n.id,
          field: 'name',
          message: `Workflow name "${n.data.name}" shadows a bundled command.`,
          quickFix: {
            title: `Rename to "${n.data.name}-flow"`,
            apply: (g: WorkflowGraph) => patchNodeData(g, n.id, 'workflow.meta', (d) => { d.name = `${d.name}-flow`; }),
          },
        }),
      );
  },
};

export const graphStructureRules: Rule[] = [cf001, cf002, cf003, cf004, cf005, cf006, cf008];
