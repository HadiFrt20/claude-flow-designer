// Graph-structure rules CF001–CF008. See docs/SPEC-VALIDATION.md ("Graph structure").
import type { Diagnostic, Rule } from '../diagnostics.js';
import type { WorkflowGraph } from '../schema/graph.js';
import type { NodeKind } from '../schema/nodes.js';
import {
  findCycle,
  isTrigger,
  nodesOfKind,
  reachableFromTriggers,
} from '../schema/graph-utils.js';
import { addNode, freshId, mapNode, removeNode } from './quickfix-utils.js';
import { DOCS_URLS } from './helpers.js';

const BUNDLED_SKILLS = new Set(['code-review', 'verify', 'review', 'security-review']);

// Kinds allowed as the target of an edge from a given source kind. This is a
// coarse compatibility table (CF005): the important negative cases are wiring a
// hook handler into a slash command, or an output.decision into a trigger.
const STEP_KINDS: ReadonlySet<NodeKind> = new Set([
  'step.prompt', 'step.shell', 'step.fileRef', 'step.subagent', 'step.mcpTool',
]);
const HOOK_HANDLER_KINDS: ReadonlySet<NodeKind> = new Set([
  'hook.command', 'hook.http', 'hook.prompt', 'hook.agent', 'step.mcpTool',
]);

function edgeAllowed(source: NodeKind, target: NodeKind): boolean {
  switch (source) {
    case 'trigger.slashCommand':
      // A command composes steps (and may delegate to a subagent).
      return STEP_KINDS.has(target);
    case 'trigger.hookEvent':
    case 'trigger.sessionStart':
      // A hook-event trigger feeds a gate or a handler.
      return target === 'gate.condition' || HOOK_HANDLER_KINDS.has(target);
    case 'gate.condition':
      return HOOK_HANDLER_KINDS.has(target);
    case 'hook.command':
    case 'hook.http':
    case 'hook.prompt':
    case 'hook.agent':
      return target === 'output.decision';
    case 'trigger.headless':
      return STEP_KINDS.has(target) || target === 'step.prompt';
    default:
      // steps → steps or a decision; keep permissive to avoid false positives.
      return STEP_KINDS.has(target) || target === 'output.decision';
  }
}

const cf001: Rule = {
  id: 'CF001',
  severity: 'error',
  run(graph) {
    // A workflow unit with nodes but no trigger has no entry point.
    if (graph.nodes.length === 0) return [];
    if (graph.nodes.some(isTrigger)) return [];
    return [
      {
        ruleId: 'CF001',
        severity: 'error',
        message: 'Workflow has no trigger node (no entry point).',
        docsUrl: DOCS_URLS.skills,
        quickFix: {
          title: 'Insert a slash-command trigger',
          apply: (g: WorkflowGraph) =>
            addNode(g, {
              id: freshId(g, 'trigger'),
              kind: 'trigger.slashCommand',
              label: 'New command',
              position: { x: 0, y: 0 },
              data: { name: g.meta.slug || 'command', description: '' },
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
    // "exactly one primary trigger per exported workflow unit" (SPEC-NODES).
    // Primary triggers are the command/headless entry points; hookEvent and
    // sessionStart are ambient and may coexist.
    const primary = graph.nodes.filter(
      (n) => n.kind === 'trigger.slashCommand' || n.kind === 'trigger.headless',
    );
    if (primary.length <= 1) return [];
    return primary.slice(1).map(
      (n): Diagnostic => ({
        ruleId: 'CF002',
        severity: 'error',
        nodeId: n.id,
        message: `More than one primary trigger in the unit (found ${primary.length}).`,
        docsUrl: DOCS_URLS.skills,
      }),
    );
  },
};

const cf003: Rule = {
  id: 'CF003',
  severity: 'error',
  run(graph) {
    // Cycle in the step chain (steps feeding each other in a loop).
    const cycle = findCycle(graph, STEP_KINDS);
    if (!cycle) return [];
    return [
      {
        ruleId: 'CF003',
        severity: 'error',
        nodeId: cycle[0],
        message: `Cycle detected in step chain: ${cycle.join(' → ')}.`,
        docsUrl: DOCS_URLS.skills,
      },
    ];
  },
};

const cf004: Rule = {
  id: 'CF004',
  severity: 'error',
  run(graph) {
    if (graph.nodes.length === 0) return [];
    // Only meaningful if there is at least one trigger (else CF001 fires).
    if (!graph.nodes.some(isTrigger)) return [];
    const reachable = reachableFromTriggers(graph);
    return graph.nodes
      .filter((n) => !reachable.has(n.id))
      .map(
        (n): Diagnostic => ({
          ruleId: 'CF004',
          severity: 'error',
          nodeId: n.id,
          message: `Orphan node "${n.label}" — no path from any trigger.`,
          quickFix: {
            title: 'Delete orphan node',
            apply: (g: WorkflowGraph) => removeNode(g, n.id),
          },
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
      if (!s || !t) continue; // dangling edge endpoints are a separate concern
      if (!edgeAllowed(s.kind, t.kind)) {
        diags.push({
          ruleId: 'CF005',
          severity: 'error',
          nodeId: t.id,
          message: `Edge connects incompatible kinds: ${s.kind} → ${t.kind}.`,
          docsUrl: DOCS_URLS.hooks,
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
        diags.push({
          ruleId: 'CF006',
          severity: 'warn',
          nodeId: n.id,
          field: 'label',
          message: 'Node has an empty label (hurts readability and generated names).',
        });
        continue;
      }
      if (n.kind === 'trigger.slashCommand' && !n.data.description.trim()) {
        diags.push({
          ruleId: 'CF006',
          severity: 'warn',
          nodeId: n.id,
          field: 'description',
          message: 'Slash command has an empty description (required for quality).',
        });
      }
      if (n.kind === 'step.subagent' && !(n.data.description ?? '').trim()) {
        diags.push({
          ruleId: 'CF006',
          severity: 'warn',
          nodeId: n.id,
          field: 'description',
          message: 'Subagent has an empty description (required for quality).',
        });
      }
    }
    return diags;
  },
};

function slugOf(n: Extract<WorkflowGraph['nodes'][number], { kind: 'trigger.slashCommand' }>): string {
  return n.data.name;
}

const cf007: Rule = {
  id: 'CF007',
  severity: 'error',
  run(graph) {
    const names = new Map<string, string[]>(); // name → nodeIds
    for (const n of nodesOfKind(graph, 'trigger.slashCommand')) {
      const k = slugOf(n);
      (names.get(k) ?? names.set(k, []).get(k)!).push(n.id);
    }
    for (const n of nodesOfKind(graph, 'step.subagent')) {
      (names.get(n.data.name) ?? names.set(n.data.name, []).get(n.data.name)!).push(n.id);
    }
    const diags: Diagnostic[] = [];
    for (const [name, ids] of names) {
      if (ids.length > 1) {
        for (const id of ids.slice(1)) {
          diags.push({
            ruleId: 'CF007',
            severity: 'error',
            nodeId: id,
            field: 'name',
            message: `Duplicate slug "${name}" across slash commands / subagents.`,
            quickFix: {
              title: `Rename to "${name}-2"`,
              apply: (g: WorkflowGraph) =>
                mapNode(g, id, (node) => {
                  if (node.kind === 'trigger.slashCommand') {
                    return { ...node, data: { ...node.data, name: `${name}-2` } };
                  }
                  if (node.kind === 'step.subagent') {
                    return { ...node, data: { ...node.data, name: `${name}-2` } };
                  }
                  return node;
                }),
            },
          });
        }
      }
    }
    return diags;
  },
};

const cf008: Rule = {
  id: 'CF008',
  severity: 'warn',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const n of nodesOfKind(graph, 'trigger.slashCommand')) {
      if (BUNDLED_SKILLS.has(n.data.name)) {
        diags.push({
          ruleId: 'CF008',
          severity: 'warn',
          nodeId: n.id,
          field: 'name',
          message: `Slash command "${n.data.name}" shadows a bundled skill.`,
          quickFix: {
            title: `Rename to "${n.data.name}-custom"`,
            apply: (g: WorkflowGraph) =>
              mapNode(g, n.id, (node) =>
                node.kind === 'trigger.slashCommand'
                  ? { ...node, data: { ...node.data, name: `${node.data.name}-custom` } }
                  : node,
              ),
          },
        });
      }
    }
    return diags;
  },
};

export const graphStructureRules: Rule[] = [
  cf001, cf002, cf003, cf004, cf005, cf006, cf007, cf008,
];
