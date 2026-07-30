// Emit a Claude Code dynamic-workflow script (.claude/workflows/<slug>.js) from a
// WorkflowGraph. SPEC-CODEGEN "Workflow script mapping". Deterministic output.
import type { GeneratedFile } from '../schema/types.js';
import type { WorkflowGraph } from '../schema/graph.js';
import type {
  WorkflowNode, NodeKind, AgentData, PipelineData, ParallelData, LoopUntilCheckData, ReturnData, BranchData, RawData,
} from '../schema/nodes.js';
import { FIELD_PATH_RE } from '../schema/nodes.js';
import { stableJson } from './json.js';
import { bindingNames } from './model.js';
import { nodeById, topoOrder, successors } from '../schema/graph-utils.js';

// --- string helpers ---------------------------------------------------------

/** Escape a user string for safe embedding in a JS template literal. */
function escapeTemplate(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

// Raw-declared binding names visible in the graph, set for one buildWorkflow call
// (synchronous, non-reentrant). A {{ref}} to one emits the bare `${name}` the author
// wrote, rather than being left an unresolved literal.
let rawBindings: ReadonlySet<string> = new Set();

/** Resolve a single {{ref}} to the JS expression body of a `${…}` interpolation. */
function resolveRef(
  ref: string,
  names: Map<string, string>,
  locals: Record<string, string>,
): string | null {
  if (ref === 'args') return 'JSON.stringify(args)';
  if (ref in locals) return locals[ref]!;
  const [id, ...fieldParts] = ref.split('.');
  const field = fieldParts.join('.');
  if (field && !FIELD_PATH_RE.test(field)) return null; // dotted-identifier only (no injection)
  // A ref to a raw-declared binding: emit the bare `${name}[.field]` verbatim — the
  // author wrote it that way and the upstream raw block declares it (CF605 checks).
  if (rawBindings.has(id!)) return field ? `${id}.${field}` : id!;
  const bind = names.get(id!);
  if (!bind) return null; // unresolved — CF605 blocks before emit; leave the literal visible
  return field ? `${bind}.${field}` : `JSON.stringify(${bind})`;
}

/**
 * Resolve {{ref}} template refs in a prompt to JS `${…}` interpolations against
 * binding names. `{{args}}` → args; `{{item}}`/`{{check}}` → the given locals;
 * `{{nodeId}}` → its binding; `{{nodeId.field}}` → binding.field. A whole-object
 * ref (no field) is JSON.stringify-wrapped so it embeds readably.
 *
 * Literal (non-ref) text is escaped so the user's backticks / `${` cannot break
 * out of the template literal; our own injected `${…}` is emitted un-escaped.
 */
function renderPrompt(
  raw: string,
  names: Map<string, string>,
  locals: Record<string, string> = {},
): string {
  let out = '';
  let last = 0;
  const re = /\{\{([^}]+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out += escapeTemplate(raw.slice(last, m.index));
    const ref = m[1]!.trim();
    const expr = resolveRef(ref, names, locals);
    out += expr === null ? escapeTemplate(m[0]) : '${' + expr + '}';
    last = re.lastIndex;
  }
  out += escapeTemplate(raw.slice(last));
  return out;
}

/**
 * Emit an `opts` object literal for an agent() call. `label` is a template that
 * may contain refs, so it is rendered and emitted as a backtick literal (which is
 * also valid for a plain label with no interpolation).
 */
function agentOpts(
  parts: { schema?: Record<string, unknown>; label?: string; model?: string; extraOpts?: Record<string, string> },
  names: Map<string, string>,
  locals: Record<string, string> = {},
): string {
  const entries: string[] = [];
  if (parts.schema) entries.push(`schema: ${inlineJson(parts.schema)}`);
  if (parts.label !== undefined) entries.push(`label: \`${renderPrompt(parts.label, names, locals)}\``);
  if (parts.model) entries.push(`model: ${JSON.stringify(parts.model)}`);
  // Passthrough opts (phase/effort/agentType/…): value is verbatim JS source.
  if (parts.extraOpts) for (const [k, v] of Object.entries(parts.extraOpts)) entries.push(`${k}: ${v}`);
  return entries.length ? `{ ${entries.join(', ')} }` : '';
}

/** A JSON value inlined into JS source, deterministic (stable key order). */
function inlineJson(value: unknown): string {
  return stableJson(value).trimEnd(); // stableJson adds a trailing newline
}

// --- emitter ----------------------------------------------------------------

// A single emitted line, tagged by whether it originates from a `raw` node's
// verbatim code. self-lint uses the raw byte spans to exempt those identifiers.
interface Line { text: string; raw: boolean }
const plain = (text: string): Line => ({ text, raw: false });

export function emitWorkflow(graph: WorkflowGraph): GeneratedFile {
  return buildWorkflow(graph).file;
}

/**
 * Emit the workflow script AND the byte ranges of every `raw` node's verbatim code
 * in the final content. Recording spans during assembly (rather than text-matching
 * afterward) is exact even for identical raw blocks and indented (arm-nested) raw.
 */
export function buildWorkflow(graph: WorkflowGraph): { file: GeneratedFile; rawRegions: { start: number; end: number }[] } {
  const names = bindingNames(graph);
  // Names declared by raw nodes — a typed prompt's {{ref}} to one emits `${name}`.
  rawBindings = new Set(graph.nodes.flatMap((n) => (n.kind === 'raw' ? (n.data.produces ?? []) : [])));
  const byId = nodeById(graph);
  const meta = graph.nodes.find((n) => n.kind === 'workflow.meta');
  const metaName = meta?.kind === 'workflow.meta' ? meta.data.name : graph.meta.slug;
  const metaDesc = meta?.kind === 'workflow.meta' ? meta.data.description : (graph.meta.description ?? '');

  const lines: Line[] = [
    plain('// Generated by claude-flow-designer. Do not edit by hand.'),
    plain(`export const meta = { name: ${JSON.stringify(metaName)}, description: ${JSON.stringify(metaDesc)} }`),
    plain(''),
  ];

  // Emit every non-meta node in topo order; emitSequence handles branch nesting
  // (arm-exclusive members are emitted inside their branch's if/else, recursively).
  // settings.model is the default a stage inherits when it routes no model of its own.
  const armMembers = branchArmMembers(graph);
  const ordered = topoOrder(graph).filter((id) => byId.get(id)?.kind !== 'workflow.meta');
  lines.push(...emitSequence(ordered, names, graph, armMembers, graph.settings.model));

  // Assemble with `lines.join('\n') + '\n'` semantics, tracking each line's byte
  // span so raw-origin lines become exempt regions for self-lint.
  let content = '';
  const rawRegions: { start: number; end: number }[] = [];
  for (const line of lines) {
    const start = content.length;
    content += line.text;
    if (line.raw && line.text.length > 0) rawRegions.push({ start, end: content.length });
    content += '\n';
  }

  return { file: { path: `.claude/workflows/${graph.meta.slug}.js`, content }, rawRegions };
}

/**
 * Emit an ordered list of node ids as statements. Any node that is arm-exclusive
 * to a branch WITHIN this list is skipped here and emitted inside that branch's
 * if/else instead (branches recurse via emitBranch → emitSequence), so a nested
 * branch keeps its own conditional rather than being flattened.
 */
function emitSequence(
  ids: string[],
  names: Map<string, string>,
  graph: WorkflowGraph,
  armMembers: Map<string, Arms>,
  defaultModel?: string,
): Line[] {
  const byId = nodeById(graph);
  const nested = new Set<string>();
  for (const id of ids) {
    const arms = armMembers.get(id);
    if (arms) for (const m of [...arms.then, ...arms.else]) nested.add(m);
  }
  const out: Line[] = [];
  let prevKind: NodeKind | null = null;
  for (const id of ids) {
    if (nested.has(id)) continue; // emitted inside its enclosing branch arm
    const node = byId.get(id);
    if (!node || node.kind === 'workflow.meta') continue;
    // One blank line BETWEEN nodes — but none between two consecutive `raw` nodes,
    // which were contiguous statements in the source (preserves original spacing).
    if (prevKind !== null && !(prevKind === 'raw' && node.kind === 'raw')) out.push(plain(''));
    if (node.kind === 'branch') out.push(...emitBranch(node, names, graph, armMembers, defaultModel));
    else out.push(...emitStatement(node, names, defaultModel));
    prevKind = node.kind;
  }
  return out;
}

/** then/else arm node-id sets per branch (strict form; see CF609). */
interface Arms { then: string[]; else: string[] }
function branchArmMembers(graph: WorkflowGraph): Map<string, Arms> {
  const order = topoOrder(graph);
  const rank = new Map(order.map((id, i) => [id, i]));
  const reach = (startId: string | undefined): Set<string> => {
    const seen = new Set<string>();
    if (!startId) return seen;
    const stack = [startId];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const n of successors(graph, id)) stack.push(n);
    }
    return seen;
  };
  const out = new Map<string, Arms>();
  for (const b of graph.nodes.filter((n) => n.kind === 'branch')) {
    const thenTarget = graph.edges.find((e) => e.source === b.id && e.sourceHandle === 'then')?.target;
    const elseTarget = graph.edges.find((e) => e.source === b.id && e.sourceHandle === 'else')?.target;
    const thenR = reach(thenTarget);
    const elseR = reach(elseTarget);
    // Strict form (CF609): arm-exclusive = reachable from one port only.
    const thenArm = [...thenR].filter((id) => !elseR.has(id)).sort((a, c) => rank.get(a)! - rank.get(c)!);
    const elseArm = [...elseR].filter((id) => !thenR.has(id)).sort((a, c) => rank.get(a)! - rank.get(c)!);
    out.set(b.id, { then: thenArm, else: elseArm });
  }
  return out;
}

function emitBranch(
  node: WorkflowNode,
  names: Map<string, string>,
  graph: WorkflowGraph,
  armMembers: Map<string, Arms>,
  defaultModel?: string,
): Line[] {
  if (node.kind !== 'branch') return [];
  const arms = armMembers.get(node.id) ?? { then: [], else: [] };
  const cond = branchCondition(node.data, names);
  // Recurse: an arm's members are themselves a sequence, so a nested branch keeps
  // its own if/else (B4) rather than flattening both inner arms unconditionally.
  // Indent EVERY line (preserving its raw flag) — fixes multi-line raw in an arm (m1).
  const arm = (ids: string[]): Line[] =>
    emitSequence(ids, names, graph, armMembers, defaultModel)
      .filter((l) => l.text !== '') // no blank lines inside the block
      .map((l) => ({ text: '  ' + l.text, raw: l.raw }));
  const out: Line[] = [plain(`if (${cond}) {`), ...arm(arms.then)];
  if (arms.else.length) out.push(plain('} else {'), ...arm(arms.else));
  out.push(plain('}')); // inter-node blank is added by emitSequence
  return out;
}

/**
 * A node's content lines (NO trailing blank — emitSequence handles inter-node
 * spacing). A `raw` node's lines are each tagged `raw` so self-lint exempts them.
 */
function emitStatement(node: WorkflowNode, names: Map<string, string>, defaultModel?: string): Line[] {
  switch (node.kind) {
    case 'agent': {
      const d = node.data as AgentData;
      const bind = names.get(node.id)!;
      const opts = agentOpts({ schema: d.schema, label: d.label, model: d.model ?? defaultModel, extraOpts: d.extraOpts }, names);
      const call = opts ? `agent(\`${renderPrompt(d.prompt, names)}\`, ${opts})` : `agent(\`${renderPrompt(d.prompt, names)}\`)`;
      return [plain(`const ${bind} = await ${call}`)];
    }
    case 'pipeline': {
      const d = node.data as PipelineData;
      const bind = names.get(node.id)!;
      const sourceExpr = pipelineSource(d.source, d.sourceField, names);
      const itemOpts = agentOpts({ schema: d.itemSchema, label: d.itemLabel, model: d.model ?? defaultModel, extraOpts: d.extraOpts }, names, { item: 'item' });
      const inner = itemOpts
        ? `agent(\`${renderPrompt(d.itemPrompt, names, { item: 'item' })}\`, ${itemOpts})`
        : `agent(\`${renderPrompt(d.itemPrompt, names, { item: 'item' })}\`)`;
      return [plain(`const ${bind} = await pipeline(${sourceExpr}, item => ${inner})`)];
    }
    case 'parallel': {
      const d = node.data as ParallelData;
      const bind = names.get(node.id)!;
      const v = d.itemVar; // the .map param name, verbatim
      const sourceExpr = pipelineSource(d.source, d.sourceField, names);
      const itemOpts = agentOpts({ schema: d.itemSchema, label: d.itemLabel, model: d.model ?? defaultModel, extraOpts: d.extraOpts }, names, { [v]: v });
      const inner = itemOpts
        ? `agent(\`${renderPrompt(d.itemPrompt, names, { [v]: v })}\`, ${itemOpts})`
        : `agent(\`${renderPrompt(d.itemPrompt, names, { [v]: v })}\`)`;
      // parallel(SOURCE.map(<v> => () => agent(...)))  — the corpus's dominant shape.
      return [plain(`const ${bind} = await parallel(${sourceExpr}.map(${v} => () => ${inner}))`)];
    }
    case 'loopUntilCheck':
      return emitLoop(node.data as LoopUntilCheckData, names.get(node.id)!, names, defaultModel).map(plain);
    case 'output.return':
      return [plain(`return ${returnExpr(node.data as ReturnData, names)}`)];
    case 'raw':
      return (node.data as RawData).code.split('\n').map((text): Line => ({ text, raw: true }));
    default:
      return [];
  }
}

/** The source-array expression for a pipeline/parallel: `args`, a node binding, or
 *  a raw-declared binding name — with an optional `.field` selector. */
function pipelineSource(source: string, sourceField: string | undefined, names: Map<string, string>): string {
  if (source === 'args') return sourceField ? `args.${sourceField}` : 'args';
  const base = names.get(source) ?? source;
  return sourceField ? `${base}.${sourceField}` : base;
}

function returnExpr(d: ReturnData, names: Map<string, string>): string {
  const bind = d.source === 'args' ? 'args' : (names.get(d.source) ?? d.source);
  let expr = d.field ? `${bind}.${d.field}` : bind;
  if (d.transform === 'filterBoolean') expr += '.filter(Boolean)';
  else if (d.transform === 'flatten') expr += '.flat()';
  return expr;
}

function emitLoop(d: LoopUntilCheckData, bind: string, names: Map<string, string>, defaultModel?: string): string[] {
  const checkOpts = agentOpts({ schema: d.checkSchema, label: 'check', model: d.checkModel ?? defaultModel }, names);
  const fixOpts = agentOpts({ label: 'fix', model: d.fixModel ?? defaultModel }, names, { check: 'JSON.stringify(check)' });
  const checkCall = checkOpts
    ? `agent(\`${renderPrompt(d.checkPrompt, names)}\`, ${checkOpts})`
    : `agent(\`${renderPrompt(d.checkPrompt, names)}\`)`;
  const fixCall = fixOpts
    ? `agent(\`${renderPrompt(d.fixPrompt, names, { check: 'JSON.stringify(check)' })}\`, ${fixOpts})`
    : `agent(\`${renderPrompt(d.fixPrompt, names, { check: 'JSON.stringify(check)' })}\`)`;
  return [
    'let round = 0',
    'let lastProgress = null',
    `let ${bind}`,
    `while (round < ${d.maxRounds}) {`,
    `  const check = await ${checkCall}`,
    `  ${bind} = check`,
    `  if (check.${d.passField}) break`,
    // Stall guard: only applies when the checker reports a numeric `progress`.
    // Schemas without a progress field simply run to maxRounds (no misfire).
    '  if (round > 0 && check.progress !== undefined && check.progress === lastProgress) break',
    '  lastProgress = check.progress',
    `  await ${fixCall}`,
    '  round++',
    '}',
  ];
}

// branch emission is exercised by validation + a dedicated test; the strict-form
// codegen (if/else with dominated arms) is intentionally minimal in this slice:
// a branch with then/else successors emits an if/else guarding each arm's single
// successor call. Kept here so the union is exhaustively handled.
export function isBranch(node: WorkflowNode): node is Extract<WorkflowNode, { kind: 'branch' }> {
  return node.kind === 'branch';
}

/** Condition expression for a branch node (used by the if/else emitter + tests). */
export function branchCondition(d: BranchData, names: Map<string, string>): string {
  const bind = d.source === 'args' ? 'args' : (names.get(d.source) ?? d.source);
  const expr = `${bind}.${d.field}`;
  return d.negate ? `!(${expr})` : expr;
}

// Re-export so callers can reach the successor helper if needed.
export { successors };
