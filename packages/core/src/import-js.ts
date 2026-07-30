// parseWorkflowJs(source) → WorkflowGraph. The inverse of codegen/workflow.ts for
// the structured subset, with best-effort fallback: any top-level statement the
// parser doesn't recognize as a typed node is preserved VERBATIM in a `raw` node
// (declaring the bindings it introduces), so downstream refs still resolve and the
// script re-exports faithfully. See docs/briefs/M7-js-importer.md.
//
// M7 decision: import parses a real .claude/workflows/<name>.js into an editable
// graph; the .clauflow.json sidecar is a derived projection, not a user artifact.
import * as acorn from 'acorn';
import type { WorkflowGraph, Edge } from './schema/graph.js';
import type { WorkflowNode, AgentData, PipelineData, ReturnData, RawData } from './schema/nodes.js';

const POS = { x: 0, y: 0 }; // canvas auto-layout assigns real positions on load

// acorn nodes are dynamically shaped; model them as a loose bag so field access
// (`node.name`, `node.body`, `node.value`, …) reads cleanly without per-site casts.
type Node = { type: string; start: number; end: number } & { [k: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Narrow-cast a value (acorn AST is structural/loose). */
function as<T>(node: unknown): T {
  return node as T;
}

function slice(src: string, node: acorn.Node): string {
  return src.slice(node.start, node.end);
}

/** camelCase-ish → a readable label; falls back to the id. */
function labelFor(binding: string | undefined, kind: string): string {
  if (!binding) return kind;
  // split camelCase into words: listRoutes → "list routes"
  return binding.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim() || kind;
}

/**
 * A template literal → a prompt string with `${expr}` turned back into a `{{ref}}`
 * template ref, when every interpolation is a shape codegen emits:
 *   ${JSON.stringify(args)}      → {{args}}
 *   ${JSON.stringify(bind)}      → {{bind}}
 *   ${bind.field}                → {{bind.field}}
 *   ${item} / ${JSON.stringify(check)} inside a pipeline/loop local → {{item}}/{{check}}
 * Returns null if any interpolation is not one of these (→ caller falls back to raw).
 */
function templateToPrompt(node: Node | undefined, src: string, locals: Set<string>): string | null {
  if (!node || node.type !== 'TemplateLiteral') return null;
  const quasis = node.quasis as { value: { cooked: string } }[];
  const exprs = node.expressions as Node[];
  let out = quasis[0]?.value.cooked ?? '';
  for (let i = 0; i < exprs.length; i++) {
    const ref = interpolationToRef(exprs[i]!, locals);
    if (ref === null) return null;
    out += `{{${ref}}}` + (quasis[i + 1]?.value.cooked ?? '');
  }
  return out;
}

function interpolationToRef(expr: Node, locals: Set<string>): string | null {
  // ${item} / ${check} → a known local
  if (expr.type === 'Identifier') {
    const name = expr.name as string;
    return locals.has(name) ? name : null;
  }
  // ${bind.field} → bind.field (member chain of identifiers)
  if (expr.type === 'MemberExpression') {
    const path = memberPath(expr);
    return path;
  }
  // ${JSON.stringify(x)} → x (whole-object ref) or the local
  if (expr.type === 'CallExpression') {
    const callee = expr.callee as Node;
    const args = expr.arguments as Node[];
    if (
      callee.type === 'MemberExpression' &&
      callee.object.type === 'Identifier' && callee.object.name === 'JSON' &&
      callee.property.name === 'stringify' &&
      args.length === 1
    ) {
      const a = args[0]!;
      if (a.type === 'Identifier') return a.name as string; // {{bind}} or {{args}}
      if (a.type === 'MemberExpression') return memberPath(a);
    }
  }
  return null;
}

/** A member expression of only non-computed identifiers → "a.b.c"; else null. */
function memberPath(node: Node): string | null {
  const parts: string[] = [];
  let cur: Node | null = node;
  while (cur && cur.type === 'MemberExpression') {
    if (cur.computed) return null;
    const prop = cur.property as Node;
    if (prop.type !== 'Identifier') return null;
    parts.unshift(prop.name);
    cur = cur.object as Node;
  }
  if (!cur || cur.type !== 'Identifier') return null;
  parts.unshift(cur.name);
  return parts.join('.');
}

/** Bindings a declaration/expression introduces at top level (for `raw.produces`). */
function declaredNames(stmt: Node): string[] {
  const out: string[] = [];
  const addPattern = (pat: Node): void => {
    if (pat.type === 'Identifier') out.push(pat.name as string);
    else if (pat.type === 'ObjectPattern') for (const p of pat.properties as Node[]) {
      const v = (p as { value?: Node; argument?: Node }).value ?? (p as { argument?: Node }).argument;
      if (v) addPattern(v);
    } else if (pat.type === 'ArrayPattern') for (const el of (pat.elements as (Node | null)[])) if (el) addPattern(el);
  };
  if (stmt.type === 'VariableDeclaration') for (const d of stmt.declarations as { id: Node }[]) addPattern(d.id);
  else if (stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') {
    const id = (stmt as { id?: Node }).id;
    if (id?.type === 'Identifier') out.push(id.name as string);
  }
  return out;
}

/**
 * The `agent(prompt, opts?)` call an `await` expression wraps, if it is exactly
 * `await agent(...)` or the inner `agent(...)` of a pipeline arrow. Returns the
 * CallExpression node or null.
 */
function agentCall(node: Node): Node | null {
  if (node.type !== 'CallExpression') return null;
  const callee = node.callee as Node;
  return callee.type === 'Identifier' && callee.name === 'agent' ? node : null;
}

/** Parse the opts ObjectExpression of an agent() call: schema/label/model. */
function parseAgentOpts(
  optsNode: Node | undefined,
  src: string,
  locals: Set<string>,
): { schema?: Record<string, unknown>; label?: string; model?: string } | null {
  if (!optsNode) return {};
  if (optsNode.type !== 'ObjectExpression') return null;
  const out: { schema?: Record<string, unknown>; label?: string; model?: string } = {};
  for (const prop of optsNode.properties as Node[]) {
    if (prop.type !== 'Property' || (prop.computed as boolean)) return null;
    const key = ((prop.key as Node).type === 'Identifier' ? (prop.key as Node).name : null);
    const val = prop.value as Node;
    if (key === 'schema') {
      const parsed = jsonLiteral(val, src);
      if (parsed === undefined) return null;
      out.schema = parsed as Record<string, unknown>;
    } else if (key === 'label') {
      const lab = val.type === 'TemplateLiteral' ? templateToPrompt(val, src, locals) : jsonStringLiteral(val);
      if (lab === null) return null;
      out.label = lab;
    } else if (key === 'model') {
      const m = jsonStringLiteral(val);
      if (m === null) return null;
      out.model = m;
    } else {
      return null; // an opts key we don't model → fall back to raw
    }
  }
  return out;
}

/** A string literal node → its value, or null. */
function jsonStringLiteral(node: Node): string | null {
  return node.type === 'Literal' && typeof node.value === 'string' ? (node.value as string) : null;
}

/** A JSON-only object/array/primitive literal → its value; undefined if it has non-literal parts. */
function jsonLiteral(node: Node, src: string): unknown {
  switch (node.type) {
    case 'Literal':
      return node.value;
    case 'ObjectExpression': {
      const obj: Record<string, unknown> = {};
      for (const p of node.properties as Node[]) {
        if (p.type !== 'Property' || (p.computed as boolean)) return undefined;
        const k = (p.key as Node).type === 'Identifier' ? (p.key as Node).name
          : (p.key as Node).type === 'Literal' ? String((p.key as Node).value) : null;
        if (k === null) return undefined;
        const v = jsonLiteral(p.value as Node, src);
        if (v === undefined) return undefined;
        obj[k] = v;
      }
      return obj;
    }
    case 'ArrayExpression': {
      const arr: unknown[] = [];
      for (const el of node.elements as (Node | null)[]) {
        if (!el) return undefined;
        const v = jsonLiteral(el, src);
        if (v === undefined) return undefined;
        arr.push(v);
      }
      return arr;
    }
    default:
      return undefined;
  }
}

interface Built {
  nodes: WorkflowNode[];
  order: string[]; // node ids in source/execution order
}

/**
 * Parse a workflow script into a graph, or null if it is not a workflow (no
 * `export const meta`). Typed nodes for the recognized subset; raw nodes (verbatim,
 * with declared bindings) for everything else. Nodes are chained meta→…→sink by
 * source order.
 */
export function parseWorkflowJs(source: string, slug = 'imported'): WorkflowGraph | null {
  let program: acorn.Program;
  try {
    program = acorn.parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    });
  } catch {
    return null; // not parseable JS
  }

  const body = program.body as Node[];
  const built: Built = { nodes: [], order: [] };
  const locals = new Set<string>(); // 'args' is implicit; pipeline/loop add item/check within
  let metaName = slug;
  let metaDesc = '';
  let sawMeta = false;
  const usedIds = new Set<string>();

  const freshId = (base: string): string => {
    let id = base || 'node';
    let i = 2;
    while (usedIds.has(id)) id = `${base}-${i++}`;
    usedIds.add(id);
    return id;
  };
  const push = (n: WorkflowNode): void => { built.nodes.push(n); built.order.push(n.id); };
  // A buffer of consecutive un-typed statements collapses into ONE raw node.
  let rawBuf: { code: string[]; produces: string[] } | null = null;
  const flushRaw = (): void => {
    if (!rawBuf) return;
    const id = freshId('raw');
    push({ id, kind: 'raw', label: 'code', position: POS, data: {
      code: rawBuf.code.join('\n'),
      ...(rawBuf.produces.length ? { produces: rawBuf.produces } : {}),
    } as RawData });
    rawBuf = null;
  };
  const toRaw = (stmt: Node): void => {
    if (!rawBuf) rawBuf = { code: [], produces: [] };
    rawBuf.code.push(slice(source, stmt));
    for (const name of declaredNames(stmt)) { rawBuf.produces.push(name); locals.add(name); }
  };

  for (const stmt of body) {
    // export const meta = { name, description, ... }
    if (stmt.type === 'ExportNamedDeclaration') {
      const decl = (stmt as { declaration?: Node }).declaration;
      const d0 = decl?.type === 'VariableDeclaration' ? (decl.declarations as { id: Node; init?: Node }[])[0] : undefined;
      if (d0 && d0.id.type === 'Identifier' && d0.id.name === 'meta') {
        sawMeta = true;
        const obj = d0.init;
        if (obj?.type === 'ObjectExpression') {
          for (const p of obj.properties as Node[]) {
            if (p.type !== 'Property') continue;
            const k = (p.key as Node).type === 'Identifier' ? (p.key as Node).name : null;
            const v = jsonStringLiteral(p.value as Node);
            if (k === 'name' && v !== null) metaName = v;
            if (k === 'description' && v !== null) metaDesc = v;
          }
        }
        continue; // meta becomes the workflow.meta node, added first below
      }
      toRaw(stmt);
      continue;
    }

    // const x = await agent(...) | await pipeline(...)
    if (stmt.type === 'VariableDeclaration') {
      const decls = stmt.declarations as { id: Node; init?: Node }[];
      const d = decls.length === 1 ? decls[0] : undefined;
      const init = d?.init;
      if (d && d.id.type === 'Identifier' && init?.type === 'AwaitExpression' && (stmt.kind as string) === 'const') {
        const call = as<{ argument: Node }>(init).argument;
        const bind = as<{ name: string }>(d.id).name;
        const typed = tryTypedCall(call, bind, source, locals, freshId);
        if (typed) { flushRaw(); locals.add(bind); push(typed); continue; }
      }
      toRaw(stmt);
      continue;
    }

    // return <expr>
    if (stmt.type === 'ReturnStatement') {
      const ret = tryReturn((stmt as { argument?: Node }).argument, source, freshId);
      if (ret) { flushRaw(); push(ret); continue; }
      toRaw(stmt);
      continue;
    }

    // anything else (if/else, while, for, expression statements, functions) → raw
    toRaw(stmt);
  }
  flushRaw();

  if (!sawMeta) return null;

  // Prepend the meta node and wire a linear chain meta → n0 → n1 → … in order.
  const metaId = freshId('meta');
  const metaNode: WorkflowNode = { id: metaId, kind: 'workflow.meta', label: labelFor(metaName, 'workflow.meta'), position: POS, data: { name: metaName, description: metaDesc } };
  const nodes = [metaNode, ...built.nodes];
  const chain = [metaId, ...built.order];
  const edges: Edge[] = [];
  for (let i = 0; i + 1 < chain.length; i++) {
    edges.push({ id: `${chain[i]}->${chain[i + 1]}`, source: chain[i]!, target: chain[i + 1]! });
  }

  // The emitted file is <slug>.js and the command is /<meta.name>, so they must
  // agree (CF611). meta.name is authoritative; derive the slug from it if a valid
  // slug, else fall back to the caller's slug (usually the source filename).
  const graphSlug = metaName && /^[a-z0-9][a-z0-9-]*$/.test(metaName) ? metaName : slug;
  return { version: 1, meta: { name: metaName, slug: graphSlug }, settings: {}, nodes, edges };
}

/** Recognize agent()/pipeline() → a typed node, else null (caller raw-wraps). */
function tryTypedCall(
  call: Node,
  bind: string,
  src: string,
  locals: Set<string>,
  freshId: (b: string) => string,
): WorkflowNode | null {
  if (call.type !== 'CallExpression') return null;
  const callee = call.callee as Node;
  const name = callee.type === 'Identifier' ? as<{ name: string }>(callee).name : null;
  const args = call.arguments as Node[];

  if (name === 'agent') {
    const prompt = templateToPrompt(args[0] as Node, src, locals);
    if (prompt === null) return null;
    const opts = parseAgentOpts(args[1] as Node | undefined, src, locals);
    if (opts === null) return null;
    const data: AgentData = { prompt, ...(opts.schema ? { schema: opts.schema } : {}), ...(opts.label !== undefined ? { label: opts.label } : {}), ...(opts.model ? { model: opts.model } : {}) };
    return { id: freshId(bind), kind: 'agent', label: labelForBinding(bind), position: POS, data };
  }

  if (name === 'pipeline') {
    // pipeline(items, item => agent(...))
    const itemsNode = args[0] as Node;
    const fn = args[1] as Node;
    if (!fn || (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression')) return null;
    const params = as<{ params: Node[] }>(fn).params;
    if (params.length !== 1 || params[0]!.type !== 'Identifier') return null;
    const itemName = as<{ name: string }>(params[0]).name;
    const fnBody = as<{ body: Node }>(fn).body;
    const inner = fnBody.type === 'BlockStatement' ? null : fnBody; // only expression-body arrows
    const innerCall = inner ? agentCall(inner) : null;
    if (!innerCall) return null;
    const src0 = pipelineSourceRef(itemsNode);
    if (src0 === null) return null;
    const itemLocals = new Set(locals); itemLocals.add(itemName === 'item' ? 'item' : itemName);
    // Only support the emitter's `item` param name for {{item}} round-trip fidelity.
    if (itemName !== 'item') return null;
    const itemPrompt = templateToPrompt((innerCall.arguments as Node[])[0] as Node, src, itemLocals);
    if (itemPrompt === null) return null;
    const opts = parseAgentOpts((innerCall.arguments as Node[])[1] as Node | undefined, src, itemLocals);
    if (opts === null) return null;
    const data: PipelineData = {
      source: src0.source,
      ...(src0.sourceField ? { sourceField: src0.sourceField } : {}),
      itemPrompt,
      ...(opts.label !== undefined ? { itemLabel: opts.label } : {}),
      ...(opts.schema ? { itemSchema: opts.schema } : {}),
      ...(opts.model ? { model: opts.model } : {}),
    };
    return { id: freshId(bind), kind: 'pipeline', label: labelForBinding(bind), position: POS, data };
  }

  return null;
}

/** pipeline items expr → {source, sourceField?}: `args`, `bind`, `bind.field`, `args.field`. */
function pipelineSourceRef(node: Node): { source: string; sourceField?: string } | null {
  if (node.type === 'Identifier') return { source: as<{ name: string }>(node).name };
  if (node.type === 'MemberExpression') {
    const path = memberPath(node);
    if (!path) return null;
    const [head, ...rest] = path.split('.');
    return rest.length ? { source: head!, sourceField: rest.join('.') } : { source: head! };
  }
  return null;
}

/** return <bind> | <bind>.field | <bind>.filter(Boolean) | <bind>.flat() → ReturnData, else null. */
function tryReturn(arg: Node | undefined, src: string, freshId: (b: string) => string): WorkflowNode | null {
  if (!arg) return null;
  let transform: ReturnData['transform'] = 'none';
  let base: Node = arg;
  // Peel a trailing .filter(Boolean) / .flat()
  if (arg.type === 'CallExpression') {
    const callee = arg.callee as Node;
    const cargs = arg.arguments as Node[];
    if (callee.type === 'MemberExpression' && !(callee.computed as boolean)) {
      const method = as<{ name: string }>(as<{ property: Node }>(callee).property).name;
      const obj = as<{ object: Node }>(callee).object;
      if (method === 'filter' && cargs.length === 1 && (cargs[0] as Node).type === 'Identifier' && as<{ name: string }>(cargs[0]).name === 'Boolean') {
        transform = 'filterBoolean'; base = obj;
      } else if (method === 'flat' && cargs.length === 0) {
        transform = 'flatten'; base = obj;
      } else {
        return null; // some other method call — raw
      }
    } else {
      return null;
    }
  }
  const path = base.type === 'Identifier' ? base.name
    : base.type === 'MemberExpression' ? memberPath(base) : null;
  if (!path) return null;
  const [head, ...rest] = path.split('.');
  const data: ReturnData = { source: head!, ...(rest.length ? { field: rest.join('.') } : {}), transform };
  return { id: freshId('return'), kind: 'output.return', label: 'return', position: POS, data };
}

function labelForBinding(bind: string): string {
  return labelFor(bind, 'agent');
}
