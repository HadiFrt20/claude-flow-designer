// WorkflowGraph + GlobalSettings schema and parse/serialize helpers.
// Source of truth: docs/SPEC-NODES.md ("Top level"). Graph version is 1.
import { z } from 'zod';
import { workflowNodeSchema } from './nodes.js';
import type { RuleId } from './types.js';

// GlobalSettings (see docs/SPEC-NODES.md). Workflow codegen reads `model` as the
// default a stage inherits when it routes no model of its own (emitWorkflow →
// emitStatement). `env` is a reserved runtime hint retained for envelope stability
// + the settings panel; it does not affect the emitted .js today.
export const globalSettingsSchema = z.object({
  model: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const edgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  label: z.string().optional(),
});

export const metaSchema = z.object({
  name: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  // RuleIds whose warnings the user has explicitly acknowledged in the export
  // dialog (persisted so they survive round-trips and show in git diffs).
  ackedWarnings: z.array(z.string() as unknown as z.ZodType<RuleId>).optional(),
});

export const workflowGraphSchema = z.object({
  version: z.literal(1),
  meta: metaSchema,
  settings: globalSettingsSchema,
  nodes: z.array(workflowNodeSchema),
  edges: z.array(edgeSchema),
});

export type GlobalSettings = z.infer<typeof globalSettingsSchema>;
export type Edge = z.infer<typeof edgeSchema>;
export type WorkflowMeta = z.infer<typeof metaSchema>;
export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;

/** Parse+validate an untrusted object into a WorkflowGraph (throws on invalid). */
export function parseGraph(input: unknown): WorkflowGraph {
  return workflowGraphSchema.parse(input);
}

/** Non-throwing variant returning zod's SafeParseReturn. */
export function safeParseGraph(input: unknown) {
  return workflowGraphSchema.safeParse(input);
}

/** Parse a `.clauflow.json` string into a WorkflowGraph. */
export function parseGraphJson(json: string): WorkflowGraph {
  return parseGraph(JSON.parse(json));
}

/** Serialize a graph to canonical JSON (2-space indent, trailing newline). */
export function serializeGraph(graph: WorkflowGraph): string {
  return JSON.stringify(graph, null, 2) + '\n';
}

/** A minimal valid graph — one slash-command trigger. Useful for tests/fixtures. */
export function emptyGraph(name: string, slug: string): WorkflowGraph {
  return {
    version: 1,
    meta: { name, slug },
    settings: {},
    nodes: [],
    edges: [],
  };
}
