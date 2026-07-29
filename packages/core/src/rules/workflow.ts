// Workflow-script rules CF601–CF615 (CF612 retired). See docs/SPEC-VALIDATION.md
// ("Workflow script").
import type { Diagnostic, Rule } from '../diagnostics.js';
import type { WorkflowNode } from '../schema/nodes.js';
import { FIELD_PATH_RE } from '../schema/nodes.js';
import { nodesOfKind, topoOrder } from '../schema/graph-utils.js';
import { producesBinding } from '../codegen/model.js';
import { DOCS_URLS, KNOWN_MODELS } from './helpers.js';
import { addNode, freshId, patchNodeData, removeNode } from './quickfix-utils.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** All {{ref}} template refs in a string (the part before any dot). */
function refsIn(text: string): { raw: string; id: string; field?: string }[] {
  const out: { raw: string; id: string; field?: string }[] = [];
  for (const m of text.matchAll(/\{\{([^}]+)\}\}/g)) {
    const ref = m[1]!.trim();
    const [id, ...rest] = ref.split('.');
    out.push({ raw: ref, id: id!, field: rest.length ? rest.join('.') : undefined });
  }
  return out;
}

/**
 * Structured result-refs a node points at via its `source` fields (node ids, not
 * template text). These become JS binding references in the emitted script exactly
 * like prompt refs, so CF609 must scope-check them too (B2).
 */
function structuredRefsOf(node: WorkflowNode): { field: string; id: string }[] {
  switch (node.kind) {
    case 'pipeline': return [{ field: 'source', id: node.data.source }];
    case 'branch': return [{ field: 'source', id: node.data.source }];
    case 'output.return': return [{ field: 'source', id: node.data.source }];
    default: return [];
  }
}

/** Prompt-bearing fields per kind, for CF604/CF605 scanning. */
function promptsOf(node: WorkflowNode): { field: string; text: string }[] {
  switch (node.kind) {
    case 'agent': return [{ field: 'prompt', text: node.data.prompt }];
    case 'pipeline': return [{ field: 'itemPrompt', text: node.data.itemPrompt }];
    case 'loopUntilCheck':
      return [
        { field: 'checkPrompt', text: node.data.checkPrompt },
        { field: 'fixPrompt', text: node.data.fixPrompt },
      ];
    default: return [];
  }
}

const cf601: Rule = {
  id: 'CF601',
  severity: 'error',
  run(graph) {
    const metas = nodesOfKind(graph, 'workflow.meta');
    if (metas.length === 1) return [];
    // CF001/CF002 also cover the 0 / >1 cases; CF601 is the workflow-specific
    // statement of the same invariant, and it carries the actionable quick fixes
    // (insert for zero; delete-extras for multiple — the latter CF002 lacks).
    if (metas.length === 0) {
      return [{
        ruleId: 'CF601', severity: 'error',
        message: 'No workflow.meta node (the workflow has no entry point).',
        docsUrl: DOCS_URLS.workflows,
        quickFix: {
          title: 'Insert a workflow.meta node',
          apply: (g) => addNode(g, {
            id: freshId(g, 'meta'), kind: 'workflow.meta', label: 'Workflow',
            position: { x: 0, y: 0 }, data: { name: g.meta.slug || 'workflow', description: '' },
          }),
        },
      }];
    }
    return metas.slice(1).map((n): Diagnostic => ({
      ruleId: 'CF601', severity: 'error', nodeId: n.id,
      message: `More than one workflow.meta node (found ${metas.length}).`,
      docsUrl: DOCS_URLS.workflows,
      quickFix: { title: 'Delete this extra workflow.meta node', apply: (g) => removeNode(g, n.id) },
    }));
  },
};

const cf602: Rule = {
  id: 'CF602',
  severity: 'error',
  run(graph) {
    return nodesOfKind(graph, 'workflow.meta')
      .filter((n) => !SLUG_RE.test(n.data.name))
      .map(
        (n): Diagnostic => ({
          ruleId: 'CF602',
          severity: 'error',
          nodeId: n.id,
          field: 'name',
          message: `workflow.meta.name "${n.data.name}" is not a valid /command slug (lowercase, digits, hyphens).`,
          docsUrl: DOCS_URLS.workflows,
          quickFix: {
            title: 'Derive name from the graph slug',
            apply: (g) => patchNodeData(g, n.id, 'workflow.meta', (d) => { d.name = g.meta.slug; }),
          },
        }),
      );
  },
};

const cf604: Rule = {
  id: 'CF604',
  severity: 'error',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const n of graph.nodes) {
      for (const { field, text } of promptsOf(n)) {
        if (!text.trim()) {
          diags.push({ ruleId: 'CF604', severity: 'error', nodeId: n.id, field, message: `${n.kind} ${field} is empty.`, docsUrl: DOCS_URLS.workflows });
        }
      }
    }
    return diags;
  },
};

const cf605: Rule = {
  id: 'CF605',
  severity: 'error',
  run(graph) {
    const order = topoOrder(graph);
    const rank = new Map(order.map((id, i) => [id, i]));
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const diags: Diagnostic[] = [];
    const locals: Record<string, Set<string>> = {
      pipeline: new Set(['item']),
      loopUntilCheck: new Set(['check']),
    };
    for (const n of graph.nodes) {
      const allowedLocal = locals[n.kind] ?? new Set<string>();
      for (const { field, text } of promptsOf(n)) {
        for (const ref of refsIn(text)) {
          // The field part is interpolated raw into JS — it must be a dotted-
          // identifier chain, never arbitrary text (else code injection; B1).
          if (ref.field !== undefined && !FIELD_PATH_RE.test(ref.field)) {
            diags.push({ ruleId: 'CF605', severity: 'error', nodeId: n.id, field, message: `Template ref {{${ref.raw}}} has an invalid field path (must be a dotted identifier).`, docsUrl: DOCS_URLS.workflows });
            continue;
          }
          if (ref.id === 'args' || allowedLocal.has(ref.id)) continue;
          const target = byId.get(ref.id);
          if (!target) {
            diags.push({ ruleId: 'CF605', severity: 'error', nodeId: n.id, field, message: `Template ref {{${ref.raw}}} references unknown node "${ref.id}".`, docsUrl: DOCS_URLS.workflows });
          } else if (!producesBinding(target)) {
            diags.push({ ruleId: 'CF605', severity: 'error', nodeId: n.id, field, message: `Template ref {{${ref.raw}}} targets ${target.kind} "${ref.id}", which produces no result binding.`, docsUrl: DOCS_URLS.workflows });
          } else if ((rank.get(ref.id) ?? Infinity) >= (rank.get(n.id) ?? -1)) {
            diags.push({ ruleId: 'CF605', severity: 'error', nodeId: n.id, field, message: `Template ref {{${ref.raw}}} is not upstream of this node.`, docsUrl: DOCS_URLS.workflows });
          }
        }
      }
    }
    return diags;
  },
};

const cf606: Rule = {
  id: 'CF606',
  severity: 'error',
  run(graph) {
    const returns = nodesOfKind(graph, 'output.return');
    if (returns.length === 0) {
      return [{ ruleId: 'CF606', severity: 'error', message: 'Workflow has no output.return node.', docsUrl: DOCS_URLS.workflows }];
    }
    const diags: Diagnostic[] = returns.slice(1).map((n) => ({ ruleId: 'CF606', severity: 'error', nodeId: n.id, message: 'More than one output.return node.', docsUrl: DOCS_URLS.workflows }));
    // A return must be a sink (no outgoing edges).
    for (const r of returns) {
      if (graph.edges.some((e) => e.source === r.id)) {
        diags.push({ ruleId: 'CF606', severity: 'error', nodeId: r.id, message: 'output.return has outgoing edges (must be the final node).', docsUrl: DOCS_URLS.workflows });
      }
    }
    return diags;
  },
};

const cf607: Rule = {
  id: 'CF607',
  severity: 'error',
  run(graph) {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const diags: Diagnostic[] = [];
    for (const p of nodesOfKind(graph, 'pipeline')) {
      const d = p.data;
      if (d.source === 'args') continue; // args used as the array — allowed
      const src = byId.get(d.source);
      if (!src) continue; // CF605 covers unknown refs
      if (!d.sourceField) {
        // Offer to point sourceField at the first array field of the source schema.
        const arrayField = src.kind === 'agent' && src.data.schema
          ? Object.entries((src.data.schema as { properties?: Record<string, { type?: string }> }).properties ?? {})
              .find(([, v]) => v?.type === 'array')?.[0]
          : undefined;
        diags.push({
          ruleId: 'CF607', severity: 'error', nodeId: p.id, field: 'sourceField',
          message: 'pipeline.source is an object result but no sourceField selects a list.',
          docsUrl: DOCS_URLS.workflows,
          ...(arrayField
            ? { quickFix: { title: `Point sourceField at "${arrayField}"`, apply: (g) => patchNodeData(g, p.id, 'pipeline', (dd) => { dd.sourceField = arrayField; }) } }
            : {}),
        });
        continue;
      }
      // Best-effort: if the source is an agent with a schema, check the field is an array.
      if (src.kind === 'agent' && src.data.schema) {
        const props = (src.data.schema as { properties?: Record<string, { type?: string }> }).properties;
        const fieldType = props?.[d.sourceField.split('.')[0]!]?.type;
        if (fieldType && fieldType !== 'array') {
          diags.push({ ruleId: 'CF607', severity: 'error', nodeId: p.id, field: 'sourceField', message: `pipeline.sourceField "${d.sourceField}" has schema type "${fieldType}", not array.`, docsUrl: DOCS_URLS.workflows });
        }
      }
    }
    return diags;
  },
};

const cf608: Rule = {
  id: 'CF608',
  severity: 'error',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const b of nodesOfKind(graph, 'branch')) {
      const out = graph.edges.filter((e) => e.source === b.id);
      const then = out.filter((e) => e.sourceHandle === 'then').length;
      const els = out.filter((e) => e.sourceHandle === 'else').length;
      if (then !== 1 || els !== 1) {
        diags.push({ ruleId: 'CF608', severity: 'error', nodeId: b.id, message: `branch needs exactly one "then" and one "else" outgoing edge (has then=${then}, else=${els}).`, docsUrl: DOCS_URLS.workflows });
      }
    }
    return diags;
  },
};

const cf609: Rule = {
  id: 'CF609',
  severity: 'error',
  run(graph) {
    // Strict-form branch merge check: a node reachable ONLY through one branch
    // arm must not be referenced (by a template ref) from outside that arm — the
    // linearizer emits arm-exclusive nodes inside the if/else, so an outside ref
    // would be to an out-of-scope binding.
    const branches = nodesOfKind(graph, 'branch');
    if (branches.length === 0) return [];
    const succ = (id: string): Set<string> => {
      const seen = new Set<string>();
      const stack = graph.edges.filter((e) => e.source === id).map((e) => e.target);
      while (stack.length) {
        const x = stack.pop()!;
        if (seen.has(x)) continue;
        seen.add(x);
        for (const e of graph.edges.filter((e) => e.source === x)) stack.push(e.target);
      }
      return seen;
    };
    const diags: Diagnostic[] = [];
    for (const b of branches) {
      const thenT = graph.edges.find((e) => e.source === b.id && e.sourceHandle === 'then')?.target;
      const elseT = graph.edges.find((e) => e.source === b.id && e.sourceHandle === 'else')?.target;
      const thenR = thenT ? new Set([thenT, ...succ(thenT)]) : new Set<string>();
      const elseR = elseT ? new Set([elseT, ...succ(elseT)]) : new Set<string>();
      const exclusive = new Map<string, 'then' | 'else'>();
      for (const id of thenR) if (!elseR.has(id)) exclusive.set(id, 'then');
      for (const id of elseR) if (!thenR.has(id)) exclusive.set(id, 'else');
      // Any node that refs an arm-exclusive binding from the OTHER arm / outside —
      // via a prompt template ref OR a structured `source` ref (return/branch/
      // pipeline). Both compile to a binding reference that would be out of scope.
      for (const n of graph.nodes) {
        const arm = exclusive.get(n.id); // which arm n belongs to (if any)
        for (const { text } of promptsOf(n)) {
          for (const ref of refsIn(text)) {
            const refArm = exclusive.get(ref.id);
            if (refArm && refArm !== arm) {
              diags.push({ ruleId: 'CF609', severity: 'error', nodeId: n.id, message: `References {{${ref.raw}}}, exclusive to the "${refArm}" arm of branch "${b.id}" — not linearizable.`, docsUrl: DOCS_URLS.workflows });
            }
          }
        }
        for (const ref of structuredRefsOf(n)) {
          const refArm = exclusive.get(ref.id);
          if (refArm && refArm !== arm) {
            diags.push({ ruleId: 'CF609', severity: 'error', nodeId: n.id, field: ref.field, message: `${n.kind}.${ref.field} references "${ref.id}", exclusive to the "${refArm}" arm of branch "${b.id}" — not linearizable.`, docsUrl: DOCS_URLS.workflows });
          }
        }
      }
    }
    return diags;
  },
};

const cf610: Rule = {
  id: 'CF610',
  severity: 'warn',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const n of nodesOfKind(graph, 'loopUntilCheck')) {
      const d = n.data;
      if (!d.checkPrompt.trim() || !d.fixPrompt.trim()) {
        diags.push({ ruleId: 'CF610', severity: 'warn', nodeId: n.id, message: 'loopUntilCheck missing checkPrompt or fixPrompt.', docsUrl: DOCS_URLS.workflows });
      }
      if (d.checkSchema) {
        const props = (d.checkSchema as { properties?: Record<string, unknown> }).properties;
        if (props && !(d.passField.split('.')[0]! in props)) {
          diags.push({ ruleId: 'CF610', severity: 'warn', nodeId: n.id, field: 'passField', message: `passField "${d.passField}" is not a property of checkSchema.`, docsUrl: DOCS_URLS.workflows });
        }
      }
    }
    return diags;
  },
};

const cf611: Rule = {
  id: 'CF611',
  severity: 'warn',
  run(graph) {
    return nodesOfKind(graph, 'workflow.meta')
      .filter((n) => n.data.name !== graph.meta.slug)
      .map(
        (n): Diagnostic => ({
          ruleId: 'CF611',
          severity: 'warn',
          nodeId: n.id,
          field: 'name',
          message: `workflow.meta.name "${n.data.name}" ≠ graph slug "${graph.meta.slug}" (file is ${graph.meta.slug}.js, command is /${n.data.name}).`,
          docsUrl: DOCS_URLS.workflows,
          quickFix: { title: 'Sync name to slug', apply: (g) => patchNodeData(g, n.id, 'workflow.meta', (d) => { d.name = g.meta.slug; }) },
        }),
      );
  },
};

const cf613: Rule = {
  id: 'CF613',
  severity: 'warn',
  run(graph) {
    const diags: Diagnostic[] = [];
    const check = (nodeId: string, model: string | undefined, field: string) => {
      if (model && !KNOWN_MODELS.has(model)) {
        diags.push({ ruleId: 'CF613', severity: 'warn', nodeId, field, message: `Unknown model "${model}".`, docsUrl: DOCS_URLS.modelConfig });
      }
    };
    for (const n of nodesOfKind(graph, 'agent')) check(n.id, n.data.model, 'model');
    for (const n of nodesOfKind(graph, 'pipeline')) check(n.id, n.data.model, 'model');
    for (const n of nodesOfKind(graph, 'loopUntilCheck')) {
      check(n.id, n.data.checkModel, 'checkModel');
      check(n.id, n.data.fixModel, 'fixModel');
    }
    return diags;
  },
};

const cf614: Rule = {
  id: 'CF614',
  severity: 'warn',
  run(graph) {
    return nodesOfKind(graph, 'pipeline')
      .filter((n) => !n.data.itemLabel)
      .map(
        (n): Diagnostic => ({
          ruleId: 'CF614',
          severity: 'warn',
          nodeId: n.id,
          field: 'itemLabel',
          message: 'pipeline has no itemLabel (the runtime fan-out is harder to read).',
          docsUrl: DOCS_URLS.workflows,
          quickFix: { title: 'Add {{item}} label', apply: (g) => patchNodeData(g, n.id, 'pipeline', (d) => { d.itemLabel = '{{item}}'; }) },
        }),
      );
  },
};

const cf615: Rule = {
  id: 'CF615',
  severity: 'info',
  run(graph) {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const diags: Diagnostic[] = [];
    for (const n of graph.nodes) {
      for (const { text } of promptsOf(n)) {
        for (const ref of refsIn(text)) {
          if (!ref.field) continue;
          const target = byId.get(ref.id);
          if (target?.kind === 'agent' && !target.data.schema) {
            const field = ref.field.split('.')[0]!;
            diags.push({
              ruleId: 'CF615', severity: 'info', nodeId: target.id, field: 'schema',
              message: `agent "${ref.id}" is referenced with .${ref.field} but has no schema (structured output recommended).`,
              docsUrl: DOCS_URLS.workflows,
              quickFix: {
                title: `Add a schema declaring "${field}"`,
                apply: (g) => patchNodeData(g, target.id, 'agent', (dd) => {
                  dd.schema = { type: 'object', properties: { [field]: {} } };
                }),
              },
            });
          }
        }
      }
    }
    return diags;
  },
};

export const workflowRules: Rule[] = [
  cf601, cf602, cf604, cf605, cf606, cf607, cf608, cf609, cf610, cf611, cf613, cf614, cf615,
];
