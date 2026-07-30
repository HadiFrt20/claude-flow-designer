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
import type { WorkflowNode, AgentData, PipelineData, ParallelData, ReturnData, RawData } from './schema/nodes.js';

const POS = { x: 0, y: 0 }; // canvas auto-layout assigns real positions on load

// acorn nodes are dynamically shaped; model them as a loose bag so field access
// (`node.name`, `node.body`, `node.value`, …) reads cleanly without per-site casts.
type Node = { type: string; start: number; end: number } & { [k: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Narrow-cast a value (acorn AST is structural/loose). */
function as<T>(node: unknown): T {
  return node as T;
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
function templateToPrompt(node: Node | undefined, src: string, refs: Refs): string | null {
  if (!node || node.type !== 'TemplateLiteral') return null;
  const quasis = node.quasis as { value: { cooked: string } }[];
  const exprs = node.expressions as Node[];
  let out = quasis[0]?.value.cooked ?? '';
  for (let i = 0; i < exprs.length; i++) {
    const ref = interpolationToRef(exprs[i]!, refs);
    if (ref === null) return null;
    out += `{{${ref}}}` + (quasis[i + 1]?.value.cooked ?? '');
  }
  return out;
}

/**
 * The names a `{{ref}}` may reconstruct, split by the EXACT JS shape the emitter
 * produces for each — so parse↔emit is a precise inverse (no round-trip loss):
 *   - `bare` (per-call locals like item/check, and RAW-declared consts): the
 *     emitter writes `${name}` / `${name.field}`, so we accept ONLY that bare form.
 *   - `node` (typed-node bindings): the emitter writes `${JSON.stringify(bind)}` for
 *     a whole ref and `${bind.field}` for a field, so we accept those two forms.
 *   - `args` is special: `${JSON.stringify(args)}` (whole) or `${args.field}`.
 * A name in neither set is NOT reconstructable — the call falls back to raw (B1).
 */
interface Refs { bare: Set<string>; node: Set<string> }

function interpolationToRef(expr: Node, refs: Refs): string | null {
  // Bare `${name}` — a local or a raw-declared binding only (emitter writes bare).
  if (expr.type === 'Identifier') {
    return refs.bare.has(expr.name as string) ? (expr.name as string) : null;
  }
  // `${name.field}` — a node binding, raw binding, or args (all emit `${name.field}`).
  if (expr.type === 'MemberExpression') {
    const path = memberPath(expr);
    if (!path) return null;
    const head = path.split('.')[0]!;
    return (refs.node.has(head) || refs.bare.has(head) || head === 'args') ? path : null;
  }
  // `${JSON.stringify(x)}` — args or a node binding (whole-object ref). NOT bare/raw.
  if (expr.type === 'CallExpression') {
    const callee = expr.callee as Node;
    const args = expr.arguments as Node[];
    if (
      callee.type === 'MemberExpression' &&
      callee.object.type === 'Identifier' && callee.object.name === 'JSON' &&
      callee.property.name === 'stringify' &&
      args.length === 1 && (args[0] as Node).type === 'Identifier'
    ) {
      const name = (args[0] as Node).name as string;
      return (name === 'args' || refs.node.has(name)) ? name : null;
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
    switch (pat.type) {
      case 'Identifier':
        out.push(pat.name as string);
        break;
      case 'ObjectPattern':
        for (const p of pat.properties as Node[]) {
          const v = (p as { value?: Node; argument?: Node }).value ?? (p as { argument?: Node }).argument;
          if (v) addPattern(v);
        }
        break;
      case 'ArrayPattern':
        for (const el of (pat.elements as (Node | null)[])) if (el) addPattern(el);
        break;
      case 'AssignmentPattern': // const { x = 1 } = …
        addPattern(as<{ left: Node }>(pat).left);
        break;
      case 'RestElement': // const [a, ...rest] = …
        addPattern(as<{ argument: Node }>(pat).argument);
        break;
    }
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

interface ParsedOpts {
  schema?: Record<string, unknown>;
  label?: string;
  model?: string;
  extraOpts?: Record<string, string>;
}

/**
 * Parse the opts ObjectExpression of an agent() call. schema/label/model are
 * modeled as typed fields; ANY OTHER opt key (phase/effort/agentType/…) is
 * preserved verbatim (its value as JS source) in `extraOpts` so the call still
 * types instead of falling to raw. Returns null only when a key/value can't be
 * safely round-tripped (computed keys, spreads, a non-round-trippable label).
 */
function parseAgentOpts(
  optsNode: Node | undefined,
  src: string,
  refs: Refs,
): ParsedOpts | null {
  if (!optsNode) return {};
  if (optsNode.type !== 'ObjectExpression') return null;
  const out: ParsedOpts = {};
  const extra: Record<string, string> = {};
  for (const prop of optsNode.properties as Node[]) {
    if (prop.type !== 'Property' || (prop.computed as boolean)) return null; // spread / computed key → raw
    const key = (prop.key as Node).type === 'Identifier' ? ((prop.key as Node).name as string)
      : (prop.key as Node).type === 'Literal' ? String((prop.key as Node).value) : null;
    if (key === null) return null;
    const val = prop.value as Node;
    if (key === 'schema') {
      const parsed = jsonLiteral(val, src);
      if (parsed === undefined) { extra[key] = src.slice(val.start, val.end); continue; } // non-literal schema → passthrough
      out.schema = parsed as Record<string, unknown>;
    } else if (key === 'label') {
      // A template/string label becomes the typed label (ref-resolved); any other
      // expression is preserved verbatim as a passthrough opt.
      const lab = val.type === 'TemplateLiteral' ? templateToPrompt(val, src, refs)
        : jsonStringLiteral(val);
      if (lab === null) extra[key] = src.slice(val.start, val.end);
      else out.label = lab;
    } else if (key === 'model') {
      const m = jsonStringLiteral(val);
      if (m === null) extra[key] = src.slice(val.start, val.end);
      else out.model = m;
    } else {
      // Unmodeled opt (phase/effort/agentType/…): keep its value as verbatim JS.
      extra[key] = src.slice(val.start, val.end);
    }
  }
  if (Object.keys(extra).length) out.extraOpts = extra;
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
  // Names a prompt {{ref}} may resolve to, split by emit shape (see Refs):
  //   node  = typed-node bindings → `${JSON.stringify(bind)}` / `${bind.field}`
  //   bare  = raw-declared consts → `${name}` / `${name.field}` (verbatim)
  // (per-call item/check locals are added transiently in parseMappedAgent).
  const refs: Refs = { bare: new Set(), node: new Set() };
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
  // M8: ONE node per top-level statement (no merging). An un-typed statement becomes
  // its own `raw` node spanning [after the previous statement … its own end], with
  // leading blank lines trimmed — so a comment ABOVE a statement attaches to its node
  // (M3) without inheriting a blank separator. `cursor` is the byte after the last
  // statement consumed (typed or raw).
  let cursor = 0;
  const emitRaw = (stmt: Node): void => {
    // Prefix any leading trivia (a comment above the statement) between the previous
    // statement and this one, with surrounding blank lines trimmed, so the comment
    // travels with its statement (M3) but no blank separator leaks in.
    const lead = source.slice(cursor, stmt.start).trim();
    const own = source.slice(stmt.start, stmt.end);
    const code = lead ? `${lead}\n${own}` : own;
    const names = declaredNames(stmt);
    // A raw block emitted here is UPSTREAM of every later statement (linear chain),
    // so a later typed prompt may reference its bindings via a BARE {{name}} —
    // codegen re-emits `${name}` and CF605 confirms upstream-ness. (Safe, unlike
    // B1: the binding provably exists upstream.)
    for (const nm of names) refs.bare.add(nm);
    push({
      id: freshId('raw'), kind: 'raw', label: 'code', position: POS,
      data: { code, ...(names.length ? { produces: names } : {}) } as RawData,
    });
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
        cursor = stmt.end;
        continue; // meta becomes the workflow.meta node, added first below
      }
      emitRaw(stmt); cursor = stmt.end;
      continue;
    }

    // const x = await agent(...) | await pipeline(...) | await parallel(...)
    if (stmt.type === 'VariableDeclaration') {
      const decls = stmt.declarations as { id: Node; init?: Node }[];
      const d = decls.length === 1 ? decls[0] : undefined;
      const init = d?.init;
      if (d && d.id.type === 'Identifier' && init?.type === 'AwaitExpression' && (stmt.kind as string) === 'const') {
        const call = as<{ argument: Node }>(init).argument;
        const bind = as<{ name: string }>(d.id).name;
        const typed = tryTypedCall(call, bind, source, refs, freshId);
        if (typed) { refs.node.add(bind); push(typed); cursor = stmt.end; continue; }
      }
      emitRaw(stmt); cursor = stmt.end;
      continue;
    }

    // return <expr>
    if (stmt.type === 'ReturnStatement') {
      const ret = tryReturn((stmt as { argument?: Node }).argument, source, freshId);
      if (ret) { push(ret); cursor = stmt.end; continue; }
      emitRaw(stmt); cursor = stmt.end;
      continue;
    }

    // anything else (if/else, while, for, expression statements, functions) → raw
    emitRaw(stmt); cursor = stmt.end;
  }

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
  refs: Refs,
  freshId: (b: string) => string,
): WorkflowNode | null {
  if (call.type !== 'CallExpression') return null;
  const callee = call.callee as Node;
  const name = callee.type === 'Identifier' ? as<{ name: string }>(callee).name : null;
  const args = call.arguments as Node[];

  if (name === 'agent') {
    const prompt = templateToPrompt(args[0] as Node, src, refs);
    if (prompt === null) return null;
    const opts = parseAgentOpts(args[1] as Node | undefined, src, refs);
    if (opts === null) return null;
    const data: AgentData = {
      prompt,
      ...(opts.schema ? { schema: opts.schema } : {}),
      ...(opts.label !== undefined ? { label: opts.label } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.extraOpts ? { extraOpts: opts.extraOpts } : {}),
    };
    return { id: freshId(bind), kind: 'agent', label: labelForBinding(bind), position: POS, data };
  }

  if (name === 'pipeline') {
    // pipeline(items, item => agent(...))
    const p = parseMappedAgent(args[0] as Node, args[1] as Node | undefined, src, refs, /*thunk*/ false);
    if (!p || p.itemVar !== 'item') return null; // pipeline uses the emitter's `item` param
    const data: PipelineData = {
      source: p.source,
      ...(p.sourceField ? { sourceField: p.sourceField } : {}),
      itemPrompt: p.itemPrompt,
      ...(p.opts.label !== undefined ? { itemLabel: p.opts.label } : {}),
      ...(p.opts.schema ? { itemSchema: p.opts.schema } : {}),
      ...(p.opts.model ? { model: p.opts.model } : {}),
      ...(p.opts.extraOpts ? { extraOpts: p.opts.extraOpts } : {}),
    };
    return { id: freshId(bind), kind: 'pipeline', label: labelForBinding(bind), position: POS, data };
  }

  if (name === 'parallel') {
    // parallel(SOURCE.map(<v> => () => agent(prompt, opts)))
    if (args.length !== 1) return null;
    const mapCall = args[0] as Node;
    if (mapCall.type !== 'CallExpression') return null;
    const mapCallee = mapCall.callee as Node;
    if (mapCallee.type !== 'MemberExpression' || (mapCallee.computed as boolean)) return null;
    if (as<{ name: string }>(as<{ property: Node }>(mapCallee).property).name !== 'map') return null;
    const sourceNode = as<{ object: Node }>(mapCallee).object;
    const src0 = pipelineSourceRef(sourceNode);
    if (src0 === null) return null;
    // The .map callback: `<v> => () => agent(...)` (thunk-wrapped).
    const p = parseMappedAgent(sourceNode, (mapCall.arguments as Node[])[0] as Node | undefined, src, refs, /*thunk*/ true);
    if (!p) return null;
    const data: ParallelData = {
      source: p.source,
      ...(p.sourceField ? { sourceField: p.sourceField } : {}),
      itemVar: p.itemVar,
      itemPrompt: p.itemPrompt,
      ...(p.opts.label !== undefined ? { itemLabel: p.opts.label } : {}),
      ...(p.opts.schema ? { itemSchema: p.opts.schema } : {}),
      ...(p.opts.model ? { model: p.opts.model } : {}),
      ...(p.opts.extraOpts ? { extraOpts: p.opts.extraOpts } : {}),
    };
    return { id: freshId(bind), kind: 'parallel', label: labelForBinding(bind), position: POS, data };
  }

  return null;
}

/**
 * Shared shape for pipeline/parallel: `<source>` + a `<v> => [() =>] agent(prompt, opts)`
 * callback. `sourceForItems` is the array being mapped/iterated; `fn` is the callback.
 * `thunk` true means the arrow returns a thunk (`() => agent(...)`, the parallel form).
 */
function parseMappedAgent(
  sourceForItems: Node,
  fn: Node | undefined,
  src: string,
  refs: Refs,
  thunk: boolean,
): { source: string; sourceField?: string; itemVar: string; itemPrompt: string; opts: ParsedOpts } | null {
  if (!fn || (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression')) return null;
  const params = as<{ params: Node[] }>(fn).params;
  if (params.length !== 1 || params[0]!.type !== 'Identifier') return null;
  const itemVar = as<{ name: string }>(params[0]).name;
  let body = as<{ body: Node }>(fn).body;
  if (body.type === 'BlockStatement') return null; // only expression-body arrows
  if (thunk) {
    // body must itself be `() => agent(...)` (a zero-arg arrow returning the call).
    if (body.type !== 'ArrowFunctionExpression') return null;
    if ((as<{ params: Node[] }>(body).params).length !== 0) return null;
    const inner = as<{ body: Node }>(body).body;
    if (inner.type === 'BlockStatement') return null;
    body = inner;
  }
  const innerCall = agentCall(body);
  if (!innerCall) return null;
  const src0 = pipelineSourceRef(sourceForItems);
  if (src0 === null) return null;
  // The map param is a per-item BARE local (emitter writes `${itemVar}`).
  const itemRefs: Refs = { bare: new Set(refs.bare).add(itemVar), node: refs.node };
  const itemPrompt = templateToPrompt((innerCall.arguments as Node[])[0] as Node, src, itemRefs);
  if (itemPrompt === null) return null;
  const opts = parseAgentOpts((innerCall.arguments as Node[])[1] as Node | undefined, src, itemRefs);
  if (opts === null) return null;
  return { source: src0.source, sourceField: src0.sourceField, itemVar, itemPrompt, opts };
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
