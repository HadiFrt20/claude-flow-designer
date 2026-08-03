// Zod schemas for every WorkflowNode kind. Source of truth: docs/SPEC-NODES.md
// ("Node union" table). Keep field-for-field parity with that doc; codegen
// (docs/SPEC-CODEGEN.md) and validation (docs/SPEC-VALIDATION.md) consume these types.
//
// M6: the graph now models a Claude Code DYNAMIC WORKFLOW (a .claude/workflows/<slug>.js
// orchestration script), not .claude/ assets. Six node kinds.
import { z } from 'zod';

const positionSchema = z.object({ x: z.number(), y: z.number() });

/**
 * A reference to another node's result: ALWAYS the producing node's id (never a
 * raw variable name). Codegen maps id → binding name, keeping the graph
 * rename-stable. Also accepts the sentinel 'args' to consume the runtime input.
 */
const resultRefSchema = z.string();

/**
 * A dotted field path into a result object, e.g. "files" or "audit.items".
 * Exported so codegen + rules validate inline `{{id.field}}` template refs with the
 * exact same shape they enforce on structured field props (no code injection).
 */
export const FIELD_PATH_RE = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;
const fieldPathSchema = z
  .string()
  .regex(FIELD_PATH_RE, 'must be a dotted identifier path');

/** An opaque JSON-Schema object, emitted verbatim (stable-key-sorted) into the script. */
const jsonSchemaShape = z.record(z.string(), z.unknown());

// ---------------------------------------------------------------------------
// The six workflow node kinds
// ---------------------------------------------------------------------------

/** The unique root: `export const meta = { name, description }`. */
export const workflowMetaDataSchema = z.object({
  name: z.string(),
  description: z.string(),
  argsHint: z.string().optional(), // doc/comment: what `args` is at invocation
});

/**
 * A `phase('title')` marker (M9): the corpus's dominant structuring primitive (176
 * uses). A bare runtime call that names the following block of work. Members are the
 * nodes whose `parentId` is this phase node; codegen emits `phase(<title>)` before
 * them, and the canvas renders a titled group container. Produces no binding, takes
 * no result ref. Phases are flat (no phase nests inside a phase).
 */
export const phaseDataSchema = z.object({
  title: z.string(),
});

/**
 * Undocumented-but-real agent opts the corpus uses (phase/effort/agentType/…),
 * preserved verbatim as raw JS value expressions keyed by opt name so a real
 * `agent(prompt, { label, phase, effort })` call types instead of falling to raw.
 * Emitted after the modeled opts (schema/label/model). Values are JS source, e.g.
 * `{ phase: "'Design'", effort: "'high'" }`.
 */
const extraOptsSchema = z.record(z.string(), z.string());

/**
 * One `agent(prompt, opts)` call → one `const` binding.
 *
 * The prompt is EITHER a template (`prompt`, with {{refs}} → `${…}`) OR a verbatim
 * JS expression (`promptExpr`, emitted as-is). Real workflows often build prompts
 * programmatically — `agent(researchPrompt(d), …)` — and the visualizer types those
 * as agent nodes via `promptExpr` rather than dropping them to raw. Exactly one of
 * the two is set (the parser picks; codegen prefers `promptExpr`).
 */
export const agentDataSchema = z.object({
  prompt: z.string().optional(), // template: may contain {{nodeId}} / {{nodeId.field}} / {{args}}
  promptExpr: z.string().optional(), // verbatim JS prompt expression (e.g. `researchPrompt(d)`)
  schema: jsonSchemaShape.optional(), // → opts.schema (structured output)
  label: z.string().optional(), // → opts.label
  model: z.string().optional(), // → opts.model (per-stage routing)
  extraOpts: extraOptsSchema.optional(), // → passthrough opts (phase/effort/agentType/…)
});

/** Fan-out: `pipeline(items, item => agent(...))`. */
export const pipelineDataSchema = z.object({
  source: resultRefSchema, // producing node id (or 'args')
  sourceField: fieldPathSchema.optional(), // which list field of that result; omit when source is itself the array
  itemPrompt: z.string().optional(), // per-item template prompt; may contain {{item}} + upstream refs
  itemPromptExpr: z.string().optional(), // OR a verbatim JS prompt expression
  itemLabel: z.string().optional(), // per-item opts.label; may contain {{item}}
  itemSchema: jsonSchemaShape.optional(),
  model: z.string().optional(),
  extraOpts: extraOptsSchema.optional(),
});

/**
 * Concurrent fan-out — the corpus's dominant primitive (118 uses):
 *   `const x = await parallel(SOURCE.map(<itemVar> => () => agent(prompt, opts)))`
 * Like pipeline but wraps each call in a thunk and preserves the map param name
 * (`d`, `c`, `t`, … — not always `item`) so it round-trips exactly.
 */
export const parallelDataSchema = z.object({
  source: resultRefSchema, // the mapped array: a node id, 'args', or a raw-declared binding
  sourceField: fieldPathSchema.optional(),
  itemVar: z.string().default('item'), // the .map param name (verbatim)
  itemPrompt: z.string().optional(), // per-item template prompt; may contain {{<itemVar>}}
  itemPromptExpr: z.string().optional(), // OR a verbatim JS prompt expression
  itemLabel: z.string().optional(),
  itemSchema: jsonSchemaShape.optional(),
  model: z.string().optional(),
  extraOpts: extraOptsSchema.optional(),
});

/**
 * One lane of a `fanout` (M10). A static-array `parallel([ … ])` is heterogeneous: each
 * element is either a literal thunk `() => agent(prompt, opts)` (a `thunk` branch) or a
 * spread `...SOURCE.map(v => () => agent(...))` (a `map` branch). A branch is an emission
 * template — codegen re-emits it in place, so a fanout round-trips exactly. Discriminated
 * on `kind`.
 */
export const fanoutBranchSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('thunk'),
    prompt: z.string().optional(), // template prompt (may contain upstream {{refs}})
    promptExpr: z.string().optional(), // OR a verbatim JS prompt expression
    label: z.string().optional(),
    schema: jsonSchemaShape.optional(),
    model: z.string().optional(),
    extraOpts: extraOptsSchema.optional(),
  }),
  z.object({
    kind: z.literal('map'),
    source: resultRefSchema, // the mapped array: a node id, 'args', or a raw-declared binding
    sourceField: fieldPathSchema.optional(),
    itemVar: z.string().default('item'), // the .map param name (verbatim)
    itemPrompt: z.string().optional(), // per-item template prompt; may contain {{<itemVar>}}
    itemPromptExpr: z.string().optional(), // OR a verbatim JS prompt expression
    itemLabel: z.string().optional(),
    itemSchema: jsonSchemaShape.optional(),
    model: z.string().optional(),
    extraOpts: extraOptsSchema.optional(),
  }),
]);

/**
 * The static-array concurrency form (M10): `const <bind> = await parallel([ … ])`, whose
 * array merges literal thunks and `...map()` spreads into one concurrent group — the shape
 * the single-source `parallel` kind cannot express. Renders as a titled container with one
 * lane per branch (a `map` lane is `× <source>`, dynamic width; a `thunk` lane is concrete).
 * `mode` is `parallel` (concurrent; also models `Promise.all`) or `pipeline`.
 */
export const fanoutDataSchema = z.object({
  // The concurrency call: `parallel([...])` or `Promise.all([...])`. Both run the lanes
  // concurrently — the only difference is which primitive the author wrote (round-trip).
  // (A per-item `pipeline(items, fn)` is the separate `pipeline` kind, NOT a fanout mode.)
  mode: z.enum(['parallel', 'promiseAll']).default('parallel'),
  branches: z.array(fanoutBranchSchema),
  // When the call binds a DESTRUCTURING pattern (`const [a, b] = await …`) rather than
  // a single name, the verbatim LHS pattern text (e.g. "[factorResults, discovered]").
  // Codegen emits it as-is; `bindingPatternNames` lists the names it introduces so
  // downstream refs resolve. Absent → the node uses its derived single binding name.
  bindingPattern: z.string().optional(),
  bindingPatternNames: z.array(z.string()).optional(),
});

/**
 * Conditional; two labeled outgoing edges (`then`/`else`). The condition is EITHER
 * structured (`source` + `field` + `negate?`, the authoring path) OR a verbatim JS
 * expression (`condExpr` — the M9 import/visualization path, mirroring agent.promptExpr):
 * a real hand-authored `if (failing.length)` / `if (!findings)` types as a branch with
 * `condExpr` set, emitted as-is and self-lint-exempt, rather than dropping the whole `if`
 * to raw. Exactly one form is used (parser sets condExpr; codegen prefers it). `source`
 * and `field` are optional so the two forms are mutually exclusive without a refine()
 * (which discriminatedUnion forbids); CF620 enforces "exactly one of" (neither/both).
 */
export const branchDataSchema = z.object({
  source: resultRefSchema.optional(), // node id whose result is tested (structured form)
  field: fieldPathSchema.optional(), // boolean-ish field on that result (structured form)
  negate: z.boolean().optional(),
  condExpr: z.string().optional(), // verbatim JS condition (imported `if` — emitted as-is)
});

/** The doc's "keep fixing until a check passes" shape → a bounded `while` loop. */
export const loopUntilCheckDataSchema = z.object({
  checkPrompt: z.string(),
  checkSchema: jsonSchemaShape.optional(),
  passField: fieldPathSchema.default('passed'),
  fixPrompt: z.string(), // may contain {{check}} to see the checker's findings
  maxRounds: z.number().int().min(1).default(2),
  checkModel: z.string().optional(),
  fixModel: z.string().optional(),
});

/** The workflow's return expression (sink; exactly one; last statement). */
export const returnDataSchema = z.object({
  source: resultRefSchema, // node id whose result is returned
  field: fieldPathSchema.optional(), // return source.field instead of the whole result
  transform: z.enum(['none', 'filterBoolean', 'flatten']).default('none'),
});

/**
 * Verbatim top-level JS the importer could not (or chose not to) model as a typed
 * node — schema consts, helper functions, `for` loops, `Promise.all`, ad-hoc
 * expressions. Emitted UNCHANGED at its position in the script. `produces` lists
 * the binding names it introduces so downstream typed nodes/refs still resolve.
 */
export const rawDataSchema = z.object({
  code: z.string(), // one or more top-level statements, verbatim (no trailing newline)
  produces: z.array(z.string()).optional(), // binding names this block declares
});

// ---------------------------------------------------------------------------
// Node union (discriminated on `kind`)
// ---------------------------------------------------------------------------

// `parentId` (M9): optional containment pointer — the id of a `phase` node that
// visually + structurally groups this node. Orthogonal to edges (execution order);
// only a phase may be a parent (CF618). Members still participate in the edge flow.
const nodeBase = { id: z.string(), label: z.string(), position: positionSchema, parentId: z.string().optional() };

function node<K extends string, D extends z.ZodTypeAny>(kind: K, data: D) {
  return z.object({ ...nodeBase, kind: z.literal(kind), data });
}

export const workflowNodeSchema = z.discriminatedUnion('kind', [
  node('workflow.meta', workflowMetaDataSchema),
  node('phase', phaseDataSchema),
  node('agent', agentDataSchema),
  node('pipeline', pipelineDataSchema),
  node('parallel', parallelDataSchema),
  node('fanout', fanoutDataSchema),
  node('branch', branchDataSchema),
  node('loopUntilCheck', loopUntilCheckDataSchema),
  node('output.return', returnDataSchema),
  node('raw', rawDataSchema),
]);

export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type NodeKind = WorkflowNode['kind'];

/** All node kinds, for exhaustiveness checks and edge-compatibility tables. */
export const NODE_KINDS = [
  'workflow.meta', 'phase', 'agent', 'pipeline', 'parallel', 'fanout', 'branch', 'loopUntilCheck', 'output.return', 'raw',
] as const satisfies readonly NodeKind[];

// Narrowed data types (handy for rule + codegen code).
export type WorkflowMetaData = z.infer<typeof workflowMetaDataSchema>;
export type PhaseData = z.infer<typeof phaseDataSchema>;
export type AgentData = z.infer<typeof agentDataSchema>;
export type PipelineData = z.infer<typeof pipelineDataSchema>;
export type ParallelData = z.infer<typeof parallelDataSchema>;
export type FanoutData = z.infer<typeof fanoutDataSchema>;
export type FanoutBranch = z.infer<typeof fanoutBranchSchema>;
export type BranchData = z.infer<typeof branchDataSchema>;
export type LoopUntilCheckData = z.infer<typeof loopUntilCheckDataSchema>;
export type ReturnData = z.infer<typeof returnDataSchema>;
export type RawData = z.infer<typeof rawDataSchema>;

/** Type guard: narrow a node to a specific kind. */
export function isKind<K extends NodeKind>(
  n: WorkflowNode,
  kind: K,
): n is Extract<WorkflowNode, { kind: K }> {
  return n.kind === kind;
}
