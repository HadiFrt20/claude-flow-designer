// Self-lint: parse every emitted artifact and assert structural invariants.
// A failure here is a codegen BUG — generate() throws rather than silently ship.
// (SPEC-CODEGEN "self-lint"; SPEC-REVIEW Loop B.)
import * as acorn from 'acorn';
import type { GeneratedFile } from '../schema/types.js';
import { isSafePath } from './paths.js';

export class SelfLintError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(`self-lint failed for ${file}: ${message}`);
    this.name = 'SelfLintError';
  }
}

function lintJson(file: GeneratedFile): void {
  try {
    JSON.parse(file.content);
  } catch (err) {
    throw new SelfLintError(`invalid JSON (${(err as Error).message})`, file.path);
  }
  if (!file.content.endsWith('\n')) throw new SelfLintError('missing trailing newline', file.path);
}

// Identifiers a workflow script may reference without declaring them, limited to
// what CODEGEN'S OWN output emits — kept tight so the check still catches a real
// codegen bug (a typo'd binding). Additional Claude Code runtime globals
// (parallel/phase/log/…) and arbitrary JS built-ins only ever appear inside `raw`
// nodes, whose identifiers are exempt from this check (opaque user code; B3).
const GLOBALS = new Set([
  // workflow runtime the emitter uses (parallel is emitted by the `parallel` kind)
  'agent', 'pipeline', 'parallel', 'args', 'meta', 'console',
  // JS built-ins the emitter can produce
  'JSON', 'Boolean', 'Number', 'String', 'Object', 'Array', 'Math', 'Promise',
  'undefined', 'null', 'NaN', 'Infinity',
]);

/**
 * Real parse of an emitted workflow .js (the honest analog of the JSON guard),
 * plus structural invariants: `export const meta` with a string name, exactly one
 * top-level return as the last statement, and every referenced identifier resolves
 * against declared bindings ∪ the globals allowlist.
 */
function lintWorkflowScript(file: GeneratedFile, rawRegions: readonly Region[] = []): void {
  const c = file.content;
  if (!c.endsWith('\n')) throw new SelfLintError('missing trailing newline', file.path);

  let program: acorn.Program;
  try {
    program = acorn.parse(c, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    });
  } catch (err) {
    throw new SelfLintError(`invalid JavaScript (${(err as Error).message})`, file.path);
  }

  // Byte ranges of verbatim `raw`-node code in the emitted file (recorded by the
  // emitter as it wrote them — exact even for identical/indented raw blocks). Raw
  // blocks are opaque user JS emitted unchanged, so we do NOT enforce closed-world
  // identifier resolution over them (a `throw new Error(…)` / `parseInt(…)` there is
  // fine; B3/B4). The check stays strict for codegen's own typed output. All OTHER
  // invariants remain global.

  const body = program.body;
  const declared = new Set<string>();
  let hasMeta = false;
  let returnCount = 0;
  let returnIndex = -1;

  body.forEach((stmt, i) => {
    // export const meta = { name: '…' }
    if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'VariableDeclaration') {
      for (const decl of stmt.declaration.declarations) {
        if (decl.id.type === 'Identifier' && decl.id.name === 'meta') hasMeta = true;
      }
    }
    // top-level const/let bindings
    if (stmt.type === 'VariableDeclaration') {
      for (const decl of stmt.declarations) {
        if (decl.id.type === 'Identifier') declared.add(decl.id.name);
      }
    }
    if (stmt.type === 'ReturnStatement') {
      returnCount++;
      returnIndex = i;
    }
  });

  if (!hasMeta) throw new SelfLintError('missing `export const meta`', file.path);
  if (returnCount !== 1) throw new SelfLintError(`expected exactly one top-level return, found ${returnCount}`, file.path);
  if (returnIndex !== body.length - 1) throw new SelfLintError('return is not the last statement', file.path);

  // Scope-aware identifier resolution: every referenced identifier must resolve
  // against a binding VISIBLE at its position (its enclosing block/function chain)
  // ∪ the globals allowlist. A flat "declared anywhere" set would false-pass a
  // top-level reference to a block-scoped binding (e.g. a branch arm's const), so
  // we model lexical scope — this is what actually catches a non-linearizable
  // branch merge escaping into the emitted `.js`. Identifiers inside a raw region
  // are exempt (opaque user code); rawRegions is read by the Identifier leaf case.
  exemptRegions = rawRegions;
  try {
    const unresolved = firstUnresolved(program, [GLOBALS]);
    if (unresolved) {
      throw new SelfLintError(`references undefined identifier "${unresolved}"`, file.path);
    }
  } finally {
    exemptRegions = [];
  }
}

/** A byte [start,end) range in the emitted file (a raw node's verbatim code). */
export interface Region { start: number; end: number }

// Set for the duration of one lintWorkflowScript call (synchronous, non-reentrant):
// byte ranges whose identifiers are exempt from resolution (verbatim raw code).
let exemptRegions: readonly Region[] = [];

function inRegions(pos: number, regions: readonly Region[]): boolean {
  return regions.some((r) => pos >= r.start && pos < r.end);
}

type Scope = Set<string>;

/** Names a binding pattern introduces (Identifier + destructuring forms). */
function patternNames(pat: acorn.Node, into: Scope): void {
  const p = pat as unknown as Record<string, acorn.Node & { name?: string } & Record<string, unknown>>;
  switch (pat.type) {
    case 'Identifier':
      into.add((pat as unknown as { name: string }).name);
      break;
    case 'ObjectPattern':
      for (const prop of (p.properties as unknown as acorn.Node[]) ?? []) {
        const pr = prop as unknown as { value?: acorn.Node; argument?: acorn.Node };
        if (pr.value) patternNames(pr.value, into);
        else if (pr.argument) patternNames(pr.argument, into);
      }
      break;
    case 'ArrayPattern':
      for (const el of (p.elements as unknown as (acorn.Node | null)[]) ?? []) if (el) patternNames(el, into);
      break;
    case 'AssignmentPattern':
      patternNames(p.left as acorn.Node, into);
      break;
    case 'RestElement':
      patternNames(p.argument as acorn.Node, into);
      break;
  }
}

/** Bindings a list of statements introduces into their shared block scope. */
function blockScope(statements: acorn.Node[]): Scope {
  const scope: Scope = new Set();
  const add = (stmt: acorn.Node): void => {
    if (stmt.type === 'VariableDeclaration') {
      for (const d of (stmt as unknown as { declarations: { id: acorn.Node }[] }).declarations) patternNames(d.id, scope);
    } else if (stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') {
      const id = (stmt as unknown as { id?: { type: string; name: string } }).id;
      if (id?.type === 'Identifier') scope.add(id.name);
    } else if (stmt.type === 'ExportNamedDeclaration') {
      const decl = (stmt as unknown as { declaration?: acorn.Node }).declaration;
      if (decl) add(decl);
    }
  };
  for (const s of statements) add(s);
  return scope;
}

function resolves(name: string, chain: Scope[]): boolean {
  return chain.some((s) => s.has(name));
}

/**
 * First identifier reference that resolves against neither its lexical scope chain
 * nor the globals, or null if every reference resolves. `chain` is outermost-first.
 */
function firstUnresolved(node: acorn.Node, chain: Scope[]): string | null {
  switch (node.type) {
    case 'Program':
    case 'BlockStatement': {
      const body = (node as unknown as { body: acorn.Node[] }).body;
      const next = [...chain, blockScope(body)];
      for (const s of body) {
        const bad = firstUnresolved(s, next);
        if (bad) return bad;
      }
      return null;
    }
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
    case 'FunctionDeclaration': {
      const fn = node as unknown as { params: acorn.Node[]; body: acorn.Node };
      const scope: Scope = new Set();
      for (const p of fn.params) patternNames(p, scope);
      const next = [...chain, scope];
      // Param default expressions can reference earlier params.
      for (const p of fn.params) {
        const bad = firstUnresolvedChildrenExcept(p, next, 'left'); // skip the pattern id(s)
        if (bad) return bad;
      }
      return firstUnresolved(fn.body, next);
    }
    case 'VariableDeclarator': {
      // The id is a declaration (already in scope); only the init is a reference.
      const init = (node as unknown as { init?: acorn.Node }).init;
      return init ? firstUnresolved(init, chain) : null;
    }
    case 'MemberExpression': {
      const m = node as unknown as { object: acorn.Node; property: acorn.Node; computed: boolean };
      const bad = firstUnresolved(m.object, chain);
      if (bad) return bad;
      return m.computed ? firstUnresolved(m.property, chain) : null;
    }
    case 'Property': {
      const pr = node as unknown as { key: acorn.Node; value: acorn.Node; computed: boolean };
      if (pr.computed) {
        const bad = firstUnresolved(pr.key, chain);
        if (bad) return bad;
      }
      return firstUnresolved(pr.value, chain);
    }
    case 'ForOfStatement':
    case 'ForInStatement': {
      // `for (const x of xs)` / `for (const x in o)`: the left binding scopes the
      // right expression's siblings and the body. Resolve the iterable first
      // (outer scope), then the body with the loop var(s) in scope.
      const f = node as unknown as { left: acorn.Node; right: acorn.Node; body: acorn.Node };
      const bad = firstUnresolved(f.right, chain);
      if (bad) return bad;
      const scope: Scope = new Set();
      if (f.left.type === 'VariableDeclaration') {
        for (const d of (f.left as unknown as { declarations: { id: acorn.Node }[] }).declarations) patternNames(d.id, scope);
      } else {
        // `for (x of …)` assigning an existing binding — no new scope var.
      }
      return firstUnresolved(f.body, [...chain, scope]);
    }
    case 'ForStatement': {
      // `for (let i = 0; i < n; i++) { … }`: init declarations scope test/update/body.
      const f = node as unknown as { init?: acorn.Node; test?: acorn.Node; update?: acorn.Node; body: acorn.Node };
      const scope: Scope = new Set();
      if (f.init?.type === 'VariableDeclaration') {
        for (const d of (f.init as unknown as { declarations: { id: acorn.Node }[] }).declarations) patternNames(d.id, scope);
      }
      const next = [...chain, scope];
      for (const part of [f.init, f.test, f.update, f.body]) {
        if (!part) continue;
        // The init's declared ids are declarations, not references — skip re-checking
        // them by resolving the declarator inits only (VariableDeclarator handles that).
        const bad = firstUnresolved(part, next);
        if (bad) return bad;
      }
      return null;
    }
    case 'Identifier': {
      const name = (node as unknown as { name: string }).name;
      if (resolves(name, chain)) return null;
      // Exempt identifiers that live inside a verbatim raw region (opaque user code).
      if (inRegions(node.start, exemptRegions)) return null;
      return name;
    }
    default:
      return firstUnresolvedChildren(node, chain);
  }
}

/** Recurse into every child node with the same scope chain. */
function firstUnresolvedChildren(node: acorn.Node, chain: Scope[]): string | null {
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (isNode(child)) {
          const bad = firstUnresolved(child, chain);
          if (bad) return bad;
        }
      }
    } else if (isNode(value)) {
      const bad = firstUnresolved(value, chain);
      if (bad) return bad;
    }
  }
  return null;
}

/** Like firstUnresolvedChildren but skips one named child (a binding pattern id). */
function firstUnresolvedChildrenExcept(node: acorn.Node, chain: Scope[], skipKey: string): string | null {
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === skipKey) continue;
    if (node.type === 'Identifier') continue; // a bare param id is a declaration
    const value = (node as unknown as Record<string, unknown>)[key];
    if (isNode(value)) {
      const bad = firstUnresolved(value, chain);
      if (bad) return bad;
    }
  }
  return null;
}

function isNode(v: unknown): v is acorn.Node {
  return typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string';
}

/**
 * Lint every generated file by type. Throws SelfLintError on the first problem.
 * `rawRegionsByPath` maps a `.js` file path → the exact byte ranges of its `raw`
 * nodes' verbatim code (recorded by the emitter). Identifiers inside those ranges
 * are exempt from resolution (opaque user code); every other invariant stays strict.
 */
export function selfLint(files: GeneratedFile[], rawRegionsByPath: ReadonlyMap<string, Region[]> = new Map()): void {
  for (const file of files) {
    // Containment first: no emitted path may escape the target directory.
    if (!isSafePath(file.path)) {
      throw new SelfLintError('unsafe path — escapes the target directory', file.path);
    }
    if (file.path.endsWith('.json')) lintJson(file);
    else if (file.path.endsWith('.js')) lintWorkflowScript(file, rawRegionsByPath.get(file.path) ?? []);
  }
}
