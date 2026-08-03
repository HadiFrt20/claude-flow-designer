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
import type { WorkflowNode, AgentData, PipelineData, ParallelData, ReturnData, RawData, FanoutData, FanoutBranch } from './schema/nodes.js';

const POS = { x: 0, y: 0 }; // canvas auto-layout assigns real positions on load

// acorn nodes are dynamically shaped; model them as a loose bag so field access
// (`node.name`, `node.body`, `node.value`, …) reads cleanly without per-site casts.
type Node = { type: string; start: number; end: number } & { [k: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Narrow-cast a value (acorn AST is structural/loose). */
function as<T>(node: unknown): T {
  return node as T;
}

/** A bare JS identifier (safe to emit unquoted as an object key). */
const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

// --- M9 structural helpers: phase markers + orchestration-gating branches -----

/** `phase('title')` bare marker → its title (string-literal arg only), else null. */
function phaseMarker(expr: Node | undefined): string | null {
  if (!expr || expr.type !== 'CallExpression') return null;
  const callee = expr.callee as Node;
  if (callee.type !== 'Identifier' || callee.name !== 'phase') return null;
  const args = expr.arguments as Node[];
  if (args.length !== 1) return null;
  return jsonStringLiteral(args[0] as Node); // null if not a string literal → caller keeps it raw
}

/** The statement list of a block, or a single statement wrapped as a one-element list. */
function blockBody(node: Node): Node[] {
  return node.type === 'BlockStatement' ? (node.body as Node[]) : [node];
}

/** Does a subtree call orchestration (agent/pipeline/parallel/phase)? (gates if→branch). */
function containsOrchestration(node: Node): boolean {
  let found = false;
  const visit = (n: Node | null | undefined): void => {
    if (found || !n || typeof n.type !== 'string') return;
    if (n.type === 'CallExpression') {
      const callee = n.callee as Node;
      if (callee?.type === 'Identifier' && ['agent', 'pipeline', 'parallel', 'phase'].includes(callee.name as string)) {
        found = true; return;
      }
    }
    for (const k of Object.keys(n)) {
      if (k === 'type' || k === 'start' || k === 'end') continue;
      const v = (n as Record<string, unknown>)[k];
      if (Array.isArray(v)) for (const c of v) { if (c && typeof (c as Node).type === 'string') visit(c as Node); }
      else if (v && typeof (v as Node).type === 'string') visit(v as Node);
    }
  };
  visit(node);
  return found;
}

/** True when an arm body has a DIRECT (top-level-of-arm) return — would create a 2nd return. */
function armHasDirectReturn(node: Node): boolean {
  return blockBody(node).some((s) => s.type === 'ReturnStatement');
}

/** The leading-whitespace width of the source line a statement starts on. */
function statementIndent(source: string, start: number): number {
  const lineStart = source.lastIndexOf('\n', start - 1) + 1;
  const line = source.slice(lineStart, start);
  return /^\s*$/.test(line) ? line.length : 0; // 0 if the statement isn't at line start
}

/**
 * Dedent every line after the first by up to `indent` columns, so a multi-line raw
 * block captured inside a source-indented arm is stored at a column-0 baseline. The
 * first line already excludes its own indent (the slice starts at the statement), so
 * only continuation lines carry the absolute indent that must be removed. Idempotent:
 * a block already at baseline (indent 0 / no leading space) is unchanged.
 */
function dedentContinuation(code: string, indent: number): string {
  if (indent <= 0) return code;
  const lines = code.split('\n');
  return lines
    .map((l, i) => {
      if (i === 0) return l;
      let strip = 0;
      while (strip < indent && strip < l.length && l[strip] === ' ') strip++;
      return l.slice(strip);
    })
    .join('\n');
}

/** camelCase-ish → a readable label; falls back to the id. */
function labelFor(binding: string | undefined, kind: string): string {
  if (!binding) return kind;
  // split camelCase into words: listRoutes → "list routes"
  return binding.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim() || kind;
}

/**
 * The prompt field for an agent call: a `{prompt}` when the argument is a template
 * literal whose interpolations all reconstruct to {{refs}}, otherwise a verbatim
 * `{promptExpr}` (any other expression — a function call like `researchPrompt(d)`,
 * a concatenation, etc.). This is what lets programmatic prompts type as agent nodes
 * (visualization-first) instead of dropping the whole call to raw. Both round-trip:
 * a template re-renders its refs, an expr is emitted as-is. Returns null only if the
 * argument is missing.
 */
function promptField(arg: Node | undefined, src: string, refs: Refs): { prompt: string } | { promptExpr: string } | null {
  if (!arg) return null;
  const tmpl = templateToPrompt(arg, src, refs);
  if (tmpl !== null) return { prompt: tmpl };
  // A parenthesized SequenceExpression `(a, b)` has a node span that EXCLUDES the
  // parens, so slicing it would turn one argument into several on re-emit (B8).
  // Refuse — the whole call falls back to raw, preserving the source exactly.
  if (arg.type === 'SequenceExpression') return null;
  return { promptExpr: src.slice(arg.start, arg.end) };
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
  // If the author's own literal text contains `{{`, our {{ref}} scheme would
  // ambiguously re-parse it — refuse to templatize (caller keeps it as promptExpr,
  // verbatim). Avoids inventing a fragile escape and guarantees round-trip fidelity.
  if (quasis.some((q) => q.value.cooked.includes('{{'))) return null;
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
    // The key is re-emitted UNQUOTED (`key: value`), so it must be a bare JS
    // identifier. A quoted/kebab key (`'agent-type'`) can't round-trip that way —
    // fall to raw rather than emit invalid JS or inject a sibling property (B1).
    if (key === null || !IDENT_RE.test(key)) return null;
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
  const edges: Edge[] = [];
  const link = (from: string, to: string, handle?: string): void => {
    edges.push({ id: `${from}->${to}${handle ? `:${handle}` : ''}`, source: from, target: to, ...(handle ? { sourceHandle: handle } : {}) });
  };
  // Push a node, optionally under a phase parent (M9). Returns the id.
  const push = (n: WorkflowNode, parentId?: string): string => {
    const withParent = parentId ? { ...n, parentId } : n;
    built.nodes.push(withParent); built.order.push(withParent.id); return withParent.id;
  };
  // M8: ONE node per statement (no merging). An un-typed statement becomes its own
  // `raw` node. At top level (`topLevel`), the raw node's code is prefixed with any
  // leading trivia (a comment above it) between `cursor` and its start, blank-trimmed,
  // so a comment travels with its statement (M3). Inside arms (structural view), raw
  // uses the statement's own span only. `cursor` is the byte after the last top-level
  // statement consumed.
  let cursor = 0;
  const rawNode = (stmt: Node, parentId: string | undefined, topLevel: boolean): string => {
    let own = source.slice(stmt.start, stmt.end);
    // Arm-nested raw (structural view): normalize continuation-line indent to a
    // column-0-relative baseline by dedenting each by the statement's own indent.
    // Otherwise emitBranch's uniform +2 indent would compound every round-trip and
    // never reach a fixpoint (the arm raw's continuation lines keep their absolute
    // source indent). Scoped to !topLevel so top-level raw stays byte-identical.
    if (!topLevel) own = dedentContinuation(own, statementIndent(source, stmt.start));
    const lead = topLevel ? source.slice(cursor, stmt.start).trim() : '';
    const code = lead ? `${lead}\n${own}` : own;
    const names = declaredNames(stmt);
    // A raw block is upstream of later statements at its level, so a later typed
    // prompt may reference its bindings via a BARE {{name}} (CF605 confirms upstream).
    for (const nm of names) refs.bare.add(nm);
    return push({
      id: freshId('raw'), kind: 'raw', label: 'code', position: POS,
      data: { code, ...(names.length ? { produces: names } : {}) } as RawData,
    }, parentId);
  };

  // Parse one statement into a node (typed, branch, or raw) and return its id, or
  // null when the statement is consumed without producing a node (meta at top level).
  // `parentId` is the enclosing phase (M9); `topLevel` gates comment capture.
  const parseStatement = (stmt: Node, parentId: string | undefined, topLevel: boolean): string | null => {
    // const x = await agent(...) | await pipeline(...) | await parallel(...)
    // const [a, b] = await parallel([...]) | await Promise.all([...])  (fanout, M10)
    if (stmt.type === 'VariableDeclaration') {
      const decls = stmt.declarations as { id: Node; init?: Node }[];
      const d = decls.length === 1 ? decls[0] : undefined;
      const init = d?.init;
      if (d && init?.type === 'AwaitExpression' && (stmt.kind as string) === 'const') {
        const call = as<{ argument: Node }>(init).argument;
        // Single-name binding: agent/pipeline/parallel/fanout all supported.
        if (d.id.type === 'Identifier') {
          const bind = as<{ name: string }>(d.id).name;
          const typed = tryTypedCall(call, bind, source, refs, freshId);
          if (typed) { refs.node.add(bind); return push(typed, parentId); }
        } else if (d.id.type === 'ArrayPattern' || d.id.type === 'ObjectPattern') {
          // Destructured binding — only a fanout (static-array parallel / Promise.all)
          // supports it; codegen re-emits the verbatim LHS pattern (M10).
          const fan = tryFanoutCall(call, source, refs);
          if (fan) {
            const patternNames = declaredNames({ type: 'VariableDeclaration', kind: 'const', declarations: [{ id: d.id }] } as unknown as Node);
            for (const nm of patternNames) refs.bare.add(nm); // downstream refs to a destructured name are bare
            const patternText = source.slice(d.id.start, d.id.end);
            return push({
              id: freshId('fanout'), kind: 'fanout', label: labelForBinding('fanout'), position: POS,
              data: { ...fan, bindingPattern: patternText, ...(patternNames.length ? { bindingPatternNames: patternNames } : {}) },
            }, parentId);
          }
        }
      }
      return rawNode(stmt, parentId, topLevel);
    }
    // return <expr>
    if (stmt.type === 'ReturnStatement') {
      const ret = tryReturn((stmt as { argument?: Node }).argument, source, freshId);
      if (ret) return push(ret, parentId);
      return rawNode(stmt, parentId, topLevel);
    }
    // if (…) { … } [else { … }] — reconstruct a branch ONLY when it gates orchestration
    // (contains an agent/pipeline/parallel/phase). Pure data-munging if → raw (unchanged).
    if (stmt.type === 'IfStatement') {
      const b = tryBranch(stmt, parentId);
      if (b) return b;
      return rawNode(stmt, parentId, topLevel);
    }
    // anything else (while, for, bare expressions, functions) → raw
    return rawNode(stmt, parentId, topLevel);
  };

  /**
   * True when a binding declared at the top of either arm is referenced AFTER the
   * `if` (a word-boundary match in the trailing source). Lifting such an `if` to a
   * branch would make that binding arm-exclusive, and a later reference to it is a
   * non-linearizable merge (CF609 error) — so we keep the whole `if` as raw instead,
   * exactly as M8 did (Tier-3 contract: an imported workflow re-emits valid JS).
   */
  function armBindingEscapes(stmt: Node): boolean {
    const consequent = stmt.consequent as Node;
    const alternate = (stmt as { alternate?: Node }).alternate;
    const names = new Set<string>();
    for (const s of blockBody(consequent)) for (const nm of declaredNames(s)) names.add(nm);
    if (alternate) for (const s of blockBody(alternate)) for (const nm of declaredNames(s)) names.add(nm);
    if (names.size === 0) return false;
    const after = source.slice(stmt.end);
    for (const nm of names) {
      const esc = nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${esc}\\b`).test(after)) return true;
    }
    return false;
  }

  /**
   * Reconstruct an `if` as a `branch` with a verbatim `condExpr`, its arms parsed as
   * `then`/`else` sub-sequences (fan-out edges). Returns the branch node id, or null
   * to keep the whole `if` as raw when it isn't safe to lift: it must gate
   * orchestration; neither arm may carry a DIRECT return (would produce a second
   * top-level return — CF606); and no arm binding may escape the arm (would be a
   * non-linearizable CF609 merge — M1). Arm members are parented to the enclosing
   * phase (branch structure is by then/else edges, not parentId).
   */
  function tryBranch(stmt: Node, parentId: string | undefined): string | null {
    const test = stmt.test as Node;
    const consequent = stmt.consequent as Node;
    const alternate = (stmt as { alternate?: Node }).alternate;
    if (!containsOrchestration(stmt)) return null;
    if (armHasDirectReturn(consequent) || (alternate && armHasDirectReturn(alternate))) return null;
    if (armBindingEscapes(stmt)) return null;
    const condExpr = source.slice(test.start, test.end);
    const bId = push({ id: freshId('branch'), kind: 'branch', label: 'branch', position: POS, data: { condExpr } }, parentId);
    // then arm (required): link the branch to the arm's head with the `then` handle.
    const thenSeq = parseSequence(blockBody(consequent), parentId, /*topLevel*/ false);
    if (thenSeq.headId) link(bId, thenSeq.headId, 'then');
    // else arm (optional): an else-less if emits `if (cond) { … }` with no else clause,
    // so we only add an `else` edge when an alternate arm exists (CF608 is relaxed for
    // condExpr branches to allow a missing else).
    if (alternate) {
      const elseSeq = parseSequence(blockBody(alternate), parentId, /*topLevel*/ false);
      if (elseSeq.headId) link(bId, elseSeq.headId, 'else');
    }
    return bId;
  }

  /**
   * Parse a run of statements into nodes + edges, returning the sequence's head and
   * tail node ids for the caller to link. A `phase('X')` marker opens a group: it is
   * pushed as a phase node (at THIS level's parentId) and becomes the parent of the
   * following siblings until the next phase. Non-phase items are chained head→tail with
   * plain edges; a branch's tail is the branch node itself (the join continues from it).
   */
  function parseSequence(stmts: Node[], parentId: string | undefined, topLevel: boolean): { headId: string | null; tailId: string | null } {
    let headId: string | null = null;
    let prevTail: string | null = null;
    let curParent = parentId; // parent for non-phase items; a phase marker updates it
    for (const stmt of stmts) {
      // phase('title') marker → a group container node; members after it belong to it.
      // A phase is ALWAYS unparented (phases are flat — no phase nests in a phase, so
      // a phase marker inside an arm under an outer phase is not parented to it; B4).
      if (stmt.type === 'ExpressionStatement') {
        const title = phaseMarker((stmt as { expression?: Node }).expression);
        if (title !== null) {
          const phId = push({ id: freshId('phase'), kind: 'phase', label: labelFor(title.replace(/\s+/g, '-').toLowerCase(), 'phase'), position: POS, data: { title } });
          if (prevTail) link(prevTail, phId);
          headId ??= phId; prevTail = phId;
          curParent = phId; // subsequent siblings are members of this phase
          if (topLevel) cursor = stmt.end;
          continue;
        }
      }
      const id = parseStatement(stmt, curParent, topLevel);
      if (topLevel) cursor = stmt.end;
      if (id === null) continue;
      // parseStatement pushes the node (and, for a branch, its arm head + internal
      // edges). Its head/tail for sequential linking is the node id itself.
      if (prevTail) link(prevTail, id);
      headId ??= id; prevTail = id;
    }
    return { headId, tailId: prevTail };
  }

  // Top-level pass: pull out `export const meta` (→ the workflow.meta node), parse the
  // rest as a sequence, then prepend meta and wire it to the sequence head.
  const rest: Node[] = [];
  for (const stmt of body) {
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
    }
    rest.push(stmt);
  }

  if (!sawMeta) return null;

  const metaId = freshId('meta');
  const seq = parseSequence(rest, undefined, /*topLevel*/ true);
  if (seq.headId) link(metaId, seq.headId);

  const metaNode: WorkflowNode = { id: metaId, kind: 'workflow.meta', label: labelFor(metaName, 'workflow.meta'), position: POS, data: { name: metaName, description: metaDesc } };
  const nodes = [metaNode, ...built.nodes];

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
    const pf = promptField(args[0] as Node | undefined, src, refs);
    if (pf === null) return null;
    const opts = parseAgentOpts(args[1] as Node | undefined, src, refs);
    if (opts === null) return null;
    const data: AgentData = {
      ...pf,
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
      ...itemPromptFields(p.prompt),
      ...(p.opts.label !== undefined ? { itemLabel: p.opts.label } : {}),
      ...(p.opts.schema ? { itemSchema: p.opts.schema } : {}),
      ...(p.opts.model ? { model: p.opts.model } : {}),
      ...(p.opts.extraOpts ? { extraOpts: p.opts.extraOpts } : {}),
    };
    return { id: freshId(bind), kind: 'pipeline', label: labelForBinding(bind), position: POS, data };
  }

  // Static-array fanout: parallel([...]) or Promise.all([...]) (M10).
  const fanFromArray = tryFanoutCall(call, src, refs);
  if (fanFromArray) {
    return { id: freshId(bind), kind: 'fanout', label: labelForBinding(bind), position: POS, data: fanFromArray };
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
      ...itemPromptFields(p.prompt),
      ...(p.opts.label !== undefined ? { itemLabel: p.opts.label } : {}),
      ...(p.opts.schema ? { itemSchema: p.opts.schema } : {}),
      ...(p.opts.model ? { model: p.opts.model } : {}),
      ...(p.opts.extraOpts ? { extraOpts: p.opts.extraOpts } : {}),
    };
    return { id: freshId(bind), kind: 'parallel', label: labelForBinding(bind), position: POS, data };
  }

  return null;
}

/** Map a promptField result to the pipeline/parallel item* field names. */
function itemPromptFields(pf: { prompt: string } | { promptExpr: string }): { itemPrompt: string } | { itemPromptExpr: string } {
  return 'prompt' in pf ? { itemPrompt: pf.prompt } : { itemPromptExpr: pf.promptExpr };
}

/**
 * Recognize a static-array concurrency call — `parallel([ … ])` (mode `parallel`) or
 * `Promise.all([ … ])` (mode `promiseAll`) — and parse its array into FanoutData, or
 * null if it isn't one (caller keeps it raw). The single-source `parallel(SRC.map())`
 * form is NOT handled here (that's the `parallel` node kind).
 */
function tryFanoutCall(call: Node, src: string, refs: Refs): FanoutData | null {
  if (call.type !== 'CallExpression') return null;
  const callee = call.callee as Node;
  const args = call.arguments as Node[];
  let mode: FanoutData['mode'] | null = null;
  if (callee.type === 'Identifier' && callee.name === 'parallel') mode = 'parallel';
  else if (
    callee.type === 'MemberExpression' && !(callee.computed as boolean) &&
    callee.object.type === 'Identifier' && callee.object.name === 'Promise' &&
    callee.property.type === 'Identifier' && callee.property.name === 'all'
  ) mode = 'promiseAll';
  if (mode === null) return null;
  if (args.length !== 1 || (args[0] as Node).type !== 'ArrayExpression') return null;
  return parseFanoutArray(args[0] as Node, mode, src, refs);
}

/**
 * Parse a static-array `parallel([ … ])` into FanoutData (M10). Each element is either a
 * literal thunk `() => agent(prompt, opts)` (→ a `thunk` branch) or a spread
 * `...SOURCE.map(v => () => agent(...))` (→ a `map` branch). Returns null (→ caller keeps
 * the call as raw) if ANY element is neither, so partial/unknown shapes never lose fidelity.
 */
function parseFanoutArray(arrayNode: Node, mode: FanoutData['mode'], src: string, refs: Refs): FanoutData | null {
  const elements = arrayNode.elements as (Node | null)[];
  if (elements.length === 0) return null; // empty array → keep raw (CF621 would flag it anyway)
  const branches: FanoutBranch[] = [];
  for (const el of elements) {
    if (!el) return null; // hole in the array → give up
    // Spread of a `.map(...)` → a map branch.
    if (el.type === 'SpreadElement') {
      const arg = as<{ argument: Node }>(el).argument;
      if (arg.type !== 'CallExpression') return null;
      const callee = arg.callee as Node;
      if (callee.type !== 'MemberExpression' || (callee.computed as boolean)) return null;
      if (as<{ name: string }>(as<{ property: Node }>(callee).property).name !== 'map') return null;
      const sourceNode = as<{ object: Node }>(callee).object;
      const p = parseMappedAgent(sourceNode, (arg.arguments as Node[])[0] as Node | undefined, src, refs, /*thunk*/ true);
      if (!p) return null;
      branches.push({
        kind: 'map', source: p.source,
        ...(p.sourceField ? { sourceField: p.sourceField } : {}),
        itemVar: p.itemVar,
        ...itemPromptFields(p.prompt),
        ...(p.opts.label !== undefined ? { itemLabel: p.opts.label } : {}),
        ...(p.opts.schema ? { itemSchema: p.opts.schema } : {}),
        ...(p.opts.model ? { model: p.opts.model } : {}),
        ...(p.opts.extraOpts ? { extraOpts: p.opts.extraOpts } : {}),
      });
      continue;
    }
    // A literal thunk `() => agent(...)` → a thunk branch.
    if (el.type === 'ArrowFunctionExpression' && (as<{ params: Node[] }>(el).params).length === 0) {
      const body = as<{ body: Node }>(el).body;
      if (body.type === 'BlockStatement') return null; // only expression-body thunks
      const innerCall = agentCall(body);
      if (!innerCall) return null;
      const pf = promptField((innerCall.arguments as Node[])[0] as Node | undefined, src, refs);
      if (pf === null) return null;
      const opts = parseAgentOpts((innerCall.arguments as Node[])[1] as Node | undefined, src, refs);
      if (opts === null) return null;
      branches.push({
        kind: 'thunk', ...pf,
        ...(opts.label !== undefined ? { label: opts.label } : {}),
        ...(opts.schema ? { schema: opts.schema } : {}),
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.extraOpts ? { extraOpts: opts.extraOpts } : {}),
      });
      continue;
    }
    return null; // some other element shape → keep the whole call raw
  }
  return { mode, branches };
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
): { source: string; sourceField?: string; itemVar: string; prompt: { prompt: string } | { promptExpr: string }; opts: ParsedOpts } | null {
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
  // The map param is a per-item BARE local (emitter writes `${itemVar}`). It SHADOWS
  // any outer node binding of the same name, so drop it from `node` — otherwise a
  // `${JSON.stringify(itemVar)}` would wrongly reconstruct and re-emit as bare (B2).
  const itemNode = new Set(refs.node); itemNode.delete(itemVar);
  const itemRefs: Refs = { bare: new Set(refs.bare).add(itemVar), node: itemNode };
  const prompt = promptField((innerCall.arguments as Node[])[0] as Node | undefined, src, itemRefs);
  if (prompt === null) return null;
  const opts = parseAgentOpts((innerCall.arguments as Node[])[1] as Node | undefined, src, itemRefs);
  if (opts === null) return null;
  return { source: src0.source, sourceField: src0.sourceField, itemVar, prompt, opts };
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
