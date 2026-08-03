// Workflow-script rules CF601–CF615 (CF612 retired). See docs/SPEC-VALIDATION.md
// ("Workflow script").
import * as acorn from 'acorn';
import type { Diagnostic, Rule } from '../diagnostics.js';
import type { WorkflowNode } from '../schema/nodes.js';
import { FIELD_PATH_RE } from '../schema/nodes.js';
import { nodesOfKind, topoOrder } from '../schema/graph-utils.js';
import { producesBinding } from '../codegen/model.js';
import { DOCS_URLS, KNOWN_MODELS } from './helpers.js';
import { addNode, freshId, patchNodeData, removeNode } from './quickfix-utils.js';

/**
 * How many top-level `return` statements a `raw` node's code contains. Imported
 * workflows whose return value is a complex expression (e.g. `return { a, b }`)
 * keep the return inside a raw block rather than an output.return node, and that
 * still satisfies the "workflow has a return" invariant (CF606) — but only if the
 * TOTAL number of returns across the graph is exactly one and it is the last
 * statement (mirrors the self-lint invariants so the gate rejects, not self-lint).
 */
function rawReturnCount(code: string): number {
  try {
    const prog = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
    return prog.body.filter((s) => s.type === 'ReturnStatement').length;
  } catch {
    return 0;
  }
}

/** True when a raw node's code ends with a top-level `return` (it can be the sink). */
function rawReturnIsLast(code: string): boolean {
  try {
    const prog = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
    return prog.body.length > 0 && prog.body[prog.body.length - 1]!.type === 'ReturnStatement';
  } catch {
    return false;
  }
}

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
    case 'parallel': return [{ field: 'source', id: node.data.source }];
    // A branch with a verbatim condExpr has no structured node-id ref (its
    // identifiers are opaque user code); only the structured form contributes one.
    case 'branch': return node.data.source !== undefined ? [{ field: 'source', id: node.data.source }] : [];
    case 'output.return': return [{ field: 'source', id: node.data.source }];
    default: return [];
  }
}

/**
 * Template-prompt fields per kind, for CF604/CF605 scanning. A node using a verbatim
 * `promptExpr` (programmatic prompt) has no template text and no {{refs}} to scan, so
 * it contributes nothing here — CF605 doesn't apply to it.
 */
function promptsOf(node: WorkflowNode): { field: string; text: string }[] {
  switch (node.kind) {
    case 'agent': return node.data.prompt !== undefined ? [{ field: 'prompt', text: node.data.prompt }] : [];
    case 'pipeline': return node.data.itemPrompt !== undefined ? [{ field: 'itemPrompt', text: node.data.itemPrompt }] : [];
    case 'parallel': return node.data.itemPrompt !== undefined ? [{ field: 'itemPrompt', text: node.data.itemPrompt }] : [];
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
      // A template prompt that is present-but-empty.
      for (const { field, text } of promptsOf(n)) {
        if (!text.trim()) {
          diags.push({ ruleId: 'CF604', severity: 'error', nodeId: n.id, field, message: `${n.kind} ${field} is empty.`, docsUrl: DOCS_URLS.workflows });
        }
      }
      // A prompt-bearing kind with NEITHER a template prompt NOR a promptExpr → the
      // emitted agent() would get an empty prompt. (promptExpr is non-empty by
      // construction, so a node carrying it is fine.)
      if (n.kind === 'agent' && n.data.prompt === undefined && n.data.promptExpr === undefined) {
        diags.push({ ruleId: 'CF604', severity: 'error', nodeId: n.id, field: 'prompt', message: 'agent has no prompt.', docsUrl: DOCS_URLS.workflows });
      }
      if ((n.kind === 'pipeline' || n.kind === 'parallel') && n.data.itemPrompt === undefined && n.data.itemPromptExpr === undefined) {
        diags.push({ ruleId: 'CF604', severity: 'error', nodeId: n.id, field: 'itemPrompt', message: `${n.kind} has no per-item prompt.`, docsUrl: DOCS_URLS.workflows });
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
    // Bindings a raw block declares (by NAME, not node id) — a typed node may
    // legitimately reference one via {{name}}. Track its topo rank for upstream-ness.
    const rawBinding = new Map<string, number>();
    for (const r of nodesOfKind(graph, 'raw')) {
      for (const name of r.data.produces ?? []) {
        rawBinding.set(name, Math.min(rawBinding.get(name) ?? Infinity, rank.get(r.id) ?? Infinity));
      }
    }
    // A fanout with a destructuring pattern (`const [a,b] = await parallel([…])`)
    // introduces bare names too — a downstream {{a}} resolves against them (M10).
    for (const fo of nodesOfKind(graph, 'fanout')) {
      for (const name of fo.data.bindingPatternNames ?? []) {
        rawBinding.set(name, Math.min(rawBinding.get(name) ?? Infinity, rank.get(fo.id) ?? Infinity));
      }
    }
    const diags: Diagnostic[] = [];
    const staticLocals: Record<string, Set<string>> = {
      pipeline: new Set(['item']),
      loopUntilCheck: new Set(['check']),
    };
    for (const n of graph.nodes) {
      // parallel's per-item local is its own itemVar (d/c/t/…), not a fixed name.
      const allowedLocal = n.kind === 'parallel'
        ? new Set([n.data.itemVar])
        : (staticLocals[n.kind] ?? new Set<string>());
      for (const { field, text } of promptsOf(n)) {
        for (const ref of refsIn(text)) {
          // The field part is interpolated raw into JS — it must be a dotted-
          // identifier chain, never arbitrary text (else code injection; B1).
          if (ref.field !== undefined && !FIELD_PATH_RE.test(ref.field)) {
            diags.push({ ruleId: 'CF605', severity: 'error', nodeId: n.id, field, message: `Template ref {{${ref.raw}}} has an invalid field path (must be a dotted identifier).`, docsUrl: DOCS_URLS.workflows });
            continue;
          }
          if (ref.id === 'args' || allowedLocal.has(ref.id)) continue;
          // A ref to a raw-declared binding resolves if the raw block is upstream.
          if (rawBinding.has(ref.id)) {
            if ((rawBinding.get(ref.id) ?? Infinity) >= (rank.get(n.id) ?? -1)) {
              diags.push({ ruleId: 'CF605', severity: 'error', nodeId: n.id, field, message: `Template ref {{${ref.raw}}} is not upstream of this node.`, docsUrl: DOCS_URLS.workflows });
            }
            continue;
          }
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
    const diags: Diagnostic[] = [];
    const returns = nodesOfKind(graph, 'output.return');
    // A raw block may carry the return(s) inside its code (imported complex return
    // expression). Both node kinds count toward the "exactly one, and last" invariant
    // — mirror self-lint here so the GATE rejects, not self-lint (B2).
    const rawNodes = nodesOfKind(graph, 'raw');
    const rawReturnTotal = rawNodes.reduce((sum, n) => sum + rawReturnCount(n.data.code), 0);
    const total = returns.length + rawReturnTotal;

    if (total === 0) {
      return [{ ruleId: 'CF606', severity: 'error', message: 'Workflow has no return (add an output.return node).', docsUrl: DOCS_URLS.workflows }];
    }
    if (total > 1) {
      // Report on the extra output.return nodes (deterministic anchor); raw-return
      // over-count still surfaces here as a graph-level error.
      for (const n of returns.slice(returns.length > 1 ? 1 : 0)) {
        diags.push({ ruleId: 'CF606', severity: 'error', nodeId: n.id, message: `Workflow has more than one return (found ${total}).`, docsUrl: DOCS_URLS.workflows });
      }
      if (diags.length === 0) {
        diags.push({ ruleId: 'CF606', severity: 'error', message: `Workflow has more than one return (found ${total}).`, docsUrl: DOCS_URLS.workflows });
      }
      return diags;
    }

    // Exactly one return. It must be the topological sink (last node, no outgoing edges).
    const order = topoOrder(graph);
    const lastId = order[order.length - 1];
    for (const r of returns) {
      if (graph.edges.some((e) => e.source === r.id)) {
        diags.push({ ruleId: 'CF606', severity: 'error', nodeId: r.id, message: 'output.return has outgoing edges (must be the final node).', docsUrl: DOCS_URLS.workflows });
      }
    }
    // If the single return lives in a raw block, that block must be last AND end
    // with the return (so the emitted script's return is the final statement).
    const rawReturnNode = rawNodes.find((n) => rawReturnCount(n.data.code) > 0);
    if (rawReturnNode) {
      if (rawReturnNode.id !== lastId || !rawReturnIsLast(rawReturnNode.data.code)) {
        diags.push({ ruleId: 'CF606', severity: 'error', nodeId: rawReturnNode.id, message: 'The returning raw block must be the final node and end with its return.', docsUrl: DOCS_URLS.workflows });
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
    // pipeline and parallel both fan out over a list source with the same semantics.
    const fanOut = [...nodesOfKind(graph, 'pipeline'), ...nodesOfKind(graph, 'parallel')];
    for (const p of fanOut) {
      const d = p.data;
      if (d.source === 'args') continue; // args used as the array — allowed
      const src = byId.get(d.source);
      // A raw-declared binding (not a node id) has no schema to check — skip.
      if (!src) continue; // CF605 covers genuinely-unknown refs
      if (!d.sourceField) {
        // Offer to point sourceField at the first array field of the source schema.
        const arrayField = src.kind === 'agent' && src.data.schema
          ? Object.entries((src.data.schema as { properties?: Record<string, { type?: string }> }).properties ?? {})
              .find(([, v]) => v?.type === 'array')?.[0]
          : undefined;
        diags.push({
          ruleId: 'CF607', severity: 'error', nodeId: p.id, field: 'sourceField',
          message: `${p.kind}.source is an object result but no sourceField selects a list.`,
          docsUrl: DOCS_URLS.workflows,
          ...(arrayField
            ? { quickFix: { title: `Point sourceField at "${arrayField}"`, apply: (g) => patchNodeData(g, p.id, p.kind, (dd) => { (dd as { sourceField?: string }).sourceField = arrayField; }) } }
            : {}),
        });
        continue;
      }
      // Best-effort: if the source is an agent with a schema, check the field is an array.
      if (src.kind === 'agent' && src.data.schema) {
        const props = (src.data.schema as { properties?: Record<string, { type?: string }> }).properties;
        const fieldType = props?.[d.sourceField.split('.')[0]!]?.type;
        if (fieldType && fieldType !== 'array') {
          diags.push({ ruleId: 'CF607', severity: 'error', nodeId: p.id, field: 'sourceField', message: `${p.kind}.sourceField "${d.sourceField}" has schema type "${fieldType}", not array.`, docsUrl: DOCS_URLS.workflows });
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
      // A structured branch needs both arms (it authors an if/else). A verbatim
      // condExpr branch (imported `if`) may be else-less — codegen emits `if (c) {…}`
      // with no else clause when there is no else edge — so only `then` is required.
      const elseRequired = b.data.condExpr === undefined;
      const ok = then === 1 && (elseRequired ? els === 1 : els <= 1);
      if (!ok) {
        const want = elseRequired ? 'exactly one "then" and one "else"' : 'exactly one "then" (and at most one "else")';
        diags.push({ ruleId: 'CF608', severity: 'error', nodeId: b.id, message: `branch needs ${want} outgoing edge (has then=${then}, else=${els}).`, docsUrl: DOCS_URLS.workflows });
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
    for (const n of nodesOfKind(graph, 'parallel')) check(n.id, n.data.model, 'model');
    for (const n of nodesOfKind(graph, 'loopUntilCheck')) {
      check(n.id, n.data.checkModel, 'checkModel');
      check(n.id, n.data.fixModel, 'fixModel');
    }
    // The graph-level default model propagates to every stage that routes none of
    // its own, so a typo here would silently mis-route the whole workflow.
    const defaultModel = graph.settings.model;
    if (defaultModel && !KNOWN_MODELS.has(defaultModel)) {
      diags.push({ ruleId: 'CF613', severity: 'warn', field: 'model', message: `Unknown default model "${defaultModel}" in workflow settings.`, docsUrl: DOCS_URLS.modelConfig });
    }
    return diags;
  },
};

const cf614: Rule = {
  id: 'CF614',
  severity: 'warn',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const n of nodesOfKind(graph, 'pipeline')) {
      if (n.data.itemLabel) continue;
      diags.push({
        ruleId: 'CF614', severity: 'warn', nodeId: n.id, field: 'itemLabel',
        message: 'pipeline has no itemLabel (the runtime fan-out is harder to read).',
        docsUrl: DOCS_URLS.workflows,
        quickFix: { title: 'Add {{item}} label', apply: (g) => patchNodeData(g, n.id, 'pipeline', (d) => { d.itemLabel = '{{item}}'; }) },
      });
    }
    for (const n of nodesOfKind(graph, 'parallel')) {
      if (n.data.itemLabel) continue;
      const v = n.data.itemVar;
      diags.push({
        ruleId: 'CF614', severity: 'warn', nodeId: n.id, field: 'itemLabel',
        message: 'parallel has no itemLabel (the runtime fan-out is harder to read).',
        docsUrl: DOCS_URLS.workflows,
        quickFix: { title: `Add {{${v}}} label`, apply: (g) => patchNodeData(g, n.id, 'parallel', (d) => { d.itemLabel = `{{${v}}}`; }) },
      });
    }
    return diags;
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

const cf616: Rule = {
  id: 'CF616',
  severity: 'info',
  run(graph) {
    return nodesOfKind(graph, 'raw').map(
      (n): Diagnostic => ({
        ruleId: 'CF616',
        severity: 'info',
        nodeId: n.id,
        message: 'Imported code the designer could not model as typed nodes — kept verbatim and editable as text; its source (incl. interstitial comments) is re-emitted as-is.',
        docsUrl: DOCS_URLS.workflows,
      }),
    );
  },
};

const cf617: Rule = {
  id: 'CF617',
  severity: 'error',
  run(graph) {
    return nodesOfKind(graph, 'phase')
      .filter((n) => !n.data.title.trim())
      .map((n): Diagnostic => ({
        ruleId: 'CF617', severity: 'error', nodeId: n.id, field: 'title',
        message: 'phase has an empty title.', docsUrl: DOCS_URLS.workflows,
      }));
  },
};

const cf618: Rule = {
  id: 'CF618',
  severity: 'error',
  run(graph) {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const diags: Diagnostic[] = [];
    const detach = (id: string) => ({ title: 'Detach from parent', apply: (g: typeof graph) => ({ ...g, nodes: g.nodes.map((m) => (m.id === id ? { ...m, parentId: undefined } : m)) }) });
    for (const n of graph.nodes) {
      if (n.parentId === undefined) continue;
      // Phases are flat: a phase node may not itself be parented (B4).
      if (n.kind === 'phase') {
        diags.push({
          ruleId: 'CF618', severity: 'error', nodeId: n.id,
          message: 'A phase cannot be nested inside another node (phases are flat).',
          docsUrl: DOCS_URLS.workflows, quickFix: detach(n.id),
        });
        continue;
      }
      const parent = byId.get(n.parentId);
      if (!parent || parent.kind !== 'phase') {
        diags.push({
          ruleId: 'CF618', severity: 'error', nodeId: n.id,
          message: parent
            ? `parentId references "${n.parentId}" (${parent.kind}), which is not a phase.`
            : `parentId references unknown node "${n.parentId}".`,
          docsUrl: DOCS_URLS.workflows, quickFix: detach(n.id),
        });
      }
    }
    return diags;
  },
};

const cf620: Rule = {
  id: 'CF620',
  severity: 'error',
  run(graph) {
    // A branch condition must be EXACTLY one of: a verbatim condExpr, or a structured
    // source (+ field). Neither → the emitter has no condition to write (invalid JS);
    // both → ambiguous (SPEC-NODES: mutually exclusive). This is the user-facing gate
    // that keeps a source-less/field-less Branch from crashing self-lint (B1).
    const diags: Diagnostic[] = [];
    for (const b of nodesOfKind(graph, 'branch')) {
      const hasExpr = b.data.condExpr !== undefined && b.data.condExpr.trim() !== '';
      const hasStructured = b.data.source !== undefined && b.data.source !== '' && b.data.field !== undefined && b.data.field !== '';
      if (hasExpr === hasStructured) { // both true, or both false
        diags.push({
          ruleId: 'CF620', severity: 'error', nodeId: b.id, field: 'condExpr',
          message: hasExpr
            ? 'branch has both a condExpr and a structured source/field (use exactly one).'
            : 'branch has no condition (set a condExpr, or a source and boolean field).',
          docsUrl: DOCS_URLS.workflows,
        });
      }
    }
    return diags;
  },
};

const cf619: Rule = {
  id: 'CF619',
  severity: 'info',
  run(graph) {
    return nodesOfKind(graph, 'branch')
      .filter((n) => n.data.condExpr !== undefined)
      .map((n): Diagnostic => ({
        ruleId: 'CF619', severity: 'info', nodeId: n.id,
        message: 'Branch condition is a verbatim expression (structural view) — re-exported in canonical form, not byte-identically to the original source.',
        docsUrl: DOCS_URLS.workflows,
      }));
  },
};

const cf621: Rule = {
  id: 'CF621',
  severity: 'error',
  run(graph) {
    return nodesOfKind(graph, 'fanout')
      .filter((n) => n.data.branches.length === 0)
      .map((n): Diagnostic => ({
        ruleId: 'CF621', severity: 'error', nodeId: n.id,
        message: 'fanout has no branches (would emit an empty parallel([])).',
        docsUrl: DOCS_URLS.workflows,
      }));
  },
};

const cf622: Rule = {
  id: 'CF622',
  severity: 'error',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const n of nodesOfKind(graph, 'fanout')) {
      n.data.branches.forEach((b, i) => {
        // A branch's agent needs a prompt: a thunk needs prompt|promptExpr; a map
        // branch needs itemPrompt|itemPromptExpr. Empty-string counts as missing.
        const has = b.kind === 'thunk'
          ? (b.prompt?.trim() || b.promptExpr?.trim())
          : (b.itemPrompt?.trim() || b.itemPromptExpr?.trim());
        if (!has) {
          diags.push({
            ruleId: 'CF622', severity: 'error', nodeId: n.id,
            message: `fanout branch ${i + 1} (${b.kind}) has no prompt.`,
            docsUrl: DOCS_URLS.workflows,
          });
        }
      });
    }
    return diags;
  },
};

export const workflowRules: Rule[] = [
  cf601, cf602, cf604, cf605, cf606, cf607, cf608, cf609, cf610, cf611, cf613, cf614, cf615, cf616,
  cf617, cf618, cf619, cf620, cf621, cf622,
];
