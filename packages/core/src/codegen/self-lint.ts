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

// Identifiers a workflow script may reference without declaring them: the
// workflow-runtime globals plus the standard JS built-ins codegen can emit.
const GLOBALS = new Set([
  // workflow runtime
  'agent', 'pipeline', 'args', 'meta', 'console',
  // JS built-ins reachable from emitted output
  'JSON', 'Boolean', 'Number', 'String', 'Object', 'Array', 'Math', 'Promise',
  'undefined', 'null', 'NaN', 'Infinity',
]);

/**
 * Real parse of an emitted workflow .js (the honest analog of the JSON guard),
 * plus structural invariants: `export const meta` with a string name, exactly one
 * top-level return as the last statement, and every referenced identifier resolves
 * against declared bindings ∪ the globals allowlist.
 */
function lintWorkflowScript(file: GeneratedFile): void {
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

  // Collect bindings declared anywhere (loops/blocks declare `round`, `check`, etc.)
  // via a shallow walk, then check top-level identifier references resolve.
  collectNestedBindings(program, declared);
  const unresolved = referencedIdentifiers(program).find((name) => !declared.has(name) && !GLOBALS.has(name));
  if (unresolved) {
    throw new SelfLintError(`references undefined identifier "${unresolved}"`, file.path);
  }
}

/** Add every declared binding name (const/let/var, params) found anywhere. */
function collectNestedBindings(root: acorn.Node, into: Set<string>): void {
  walk(root, (node) => {
    if (node.type === 'VariableDeclarator') {
      const id = (node as unknown as { id: acorn.Node }).id;
      if (id.type === 'Identifier') into.add((id as unknown as { name: string }).name);
    }
    if ((node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') ) {
      for (const p of (node as unknown as { params: acorn.Node[] }).params) {
        if (p.type === 'Identifier') into.add((p as unknown as { name: string }).name);
      }
    }
  });
}

/** All identifier names used in a "value" position (best-effort, over the AST). */
function referencedIdentifiers(root: acorn.Node): string[] {
  const names: string[] = [];
  walk(root, (node, parent) => {
    if (node.type !== 'Identifier') return;
    const name = (node as unknown as { name: string }).name;
    // Skip declaration ids and property keys / member .field accesses.
    if (parent) {
      if (parent.type === 'VariableDeclarator' && (parent as unknown as { id: acorn.Node }).id === node) return;
      if (parent.type === 'MemberExpression' && (parent as unknown as { property: acorn.Node }).property === node && !(parent as unknown as { computed: boolean }).computed) return;
      if (parent.type === 'Property' && (parent as unknown as { key: acorn.Node }).key === node) return;
      if ((parent.type === 'ArrowFunctionExpression' || parent.type === 'FunctionExpression') && (parent as unknown as { params: acorn.Node[] }).params.includes(node)) return;
    }
    names.push(name);
  });
  return names;
}

/** Minimal recursive AST walk invoking `visit(node, parent)`. */
function walk(node: acorn.Node, visit: (n: acorn.Node, parent?: acorn.Node) => void, parent?: acorn.Node): void {
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const child of value) if (isNode(child)) walk(child, visit, node);
    } else if (isNode(value)) {
      walk(value, visit, node);
    }
  }
}

function isNode(v: unknown): v is acorn.Node {
  return typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string';
}

/** Lint every generated file by type. Throws SelfLintError on the first problem. */
export function selfLint(files: GeneratedFile[]): void {
  for (const file of files) {
    // Containment first: no emitted path may escape the target directory.
    if (!isSafePath(file.path)) {
      throw new SelfLintError('unsafe path — escapes the target directory', file.path);
    }
    if (file.path.endsWith('.json')) lintJson(file);
    else if (file.path.endsWith('.js')) lintWorkflowScript(file);
  }
}
