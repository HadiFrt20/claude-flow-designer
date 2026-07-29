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

/** A dotted field path into a result object, e.g. "files" or "audit.items". */
const fieldPathSchema = z
  .string()
  .regex(/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/, 'must be a dotted identifier path');

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

/** One `agent(prompt, opts)` call → one `const` binding. */
export const agentDataSchema = z.object({
  prompt: z.string(), // template: may contain {{nodeId}} / {{nodeId.field}} / {{args}}
  schema: jsonSchemaShape.optional(), // → opts.schema (structured output)
  label: z.string().optional(), // → opts.label
  model: z.string().optional(), // → opts.model (per-stage routing)
});

/** Fan-out: `pipeline(items, item => agent(...))`. */
export const pipelineDataSchema = z.object({
  source: resultRefSchema, // producing node id (or 'args')
  sourceField: fieldPathSchema.optional(), // which list field of that result; omit when source is itself the array
  itemPrompt: z.string(), // per-item prompt; may contain {{item}} + upstream refs
  itemLabel: z.string().optional(), // per-item opts.label; may contain {{item}}
  itemSchema: jsonSchemaShape.optional(),
  model: z.string().optional(),
});

/** Conditional on an agent result; two labeled outgoing edges (`then`/`else`). */
export const branchDataSchema = z.object({
  source: resultRefSchema, // node id whose result is tested
  field: fieldPathSchema, // boolean-ish field on that result
  negate: z.boolean().optional(),
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

// ---------------------------------------------------------------------------
// Node union (discriminated on `kind`)
// ---------------------------------------------------------------------------

const nodeBase = { id: z.string(), label: z.string(), position: positionSchema };

function node<K extends string, D extends z.ZodTypeAny>(kind: K, data: D) {
  return z.object({ ...nodeBase, kind: z.literal(kind), data });
}

export const workflowNodeSchema = z.discriminatedUnion('kind', [
  node('workflow.meta', workflowMetaDataSchema),
  node('agent', agentDataSchema),
  node('pipeline', pipelineDataSchema),
  node('branch', branchDataSchema),
  node('loopUntilCheck', loopUntilCheckDataSchema),
  node('output.return', returnDataSchema),
]);

export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type NodeKind = WorkflowNode['kind'];

/** All node kinds, for exhaustiveness checks and edge-compatibility tables. */
export const NODE_KINDS = [
  'workflow.meta', 'agent', 'pipeline', 'branch', 'loopUntilCheck', 'output.return',
] as const satisfies readonly NodeKind[];

// Narrowed data types (handy for rule + codegen code).
export type WorkflowMetaData = z.infer<typeof workflowMetaDataSchema>;
export type AgentData = z.infer<typeof agentDataSchema>;
export type PipelineData = z.infer<typeof pipelineDataSchema>;
export type BranchData = z.infer<typeof branchDataSchema>;
export type LoopUntilCheckData = z.infer<typeof loopUntilCheckDataSchema>;
export type ReturnData = z.infer<typeof returnDataSchema>;

/** Type guard: narrow a node to a specific kind. */
export function isKind<K extends NodeKind>(
  n: WorkflowNode,
  kind: K,
): n is Extract<WorkflowNode, { kind: K }> {
  return n.kind === kind;
}
