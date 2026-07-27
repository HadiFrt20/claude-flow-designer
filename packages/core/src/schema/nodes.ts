// Zod schemas for every WorkflowNode kind. Source of truth: docs/SPEC-NODES.md
// ("Node union" table). Keep field-for-field parity with that doc; codegen
// (docs/SPEC-CODEGEN.md) and validation (docs/SPEC-VALIDATION.md) consume these types.
import { z } from 'zod';
import type { Effort, HookEvent, PermissionMode } from './types.js';

// Value tuples used to build zod enums. `satisfies` pins them to the hand-written
// unions in types.ts so the two can never silently drift.
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly Effort[];
const PERMISSION_MODES = [
  'default', 'plan', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions',
] as const satisfies readonly PermissionMode[];
const HOOK_EVENTS = [
  'SessionStart', 'Setup', 'InstructionsLoaded', 'UserPromptSubmit',
  'UserPromptExpansion', 'PreToolUse', 'PermissionRequest', 'PermissionDenied',
  'PostToolUse', 'PostToolUseFailure', 'PostToolBatch', 'Notification',
  'MessageDisplay', 'SubagentStart', 'SubagentStop', 'TaskCreated',
  'TaskCompleted', 'Stop', 'StopFailure', 'TeammateIdle', 'ConfigChange',
  'CwdChanged', 'FileChanged', 'WorktreeCreate', 'WorktreeRemove',
  'PreCompact', 'PostCompact', 'Elicitation', 'ElicitationResult', 'SessionEnd',
] as const satisfies readonly HookEvent[];

export const effortSchema = z.enum(EFFORTS);
export const permissionModeSchema = z.enum(PERMISSION_MODES);
export const hookEventSchema = z.enum(HOOK_EVENTS);

const positionSchema = z.object({ x: z.number(), y: z.number() });

/** Positional / named argument placeholder used by a slash command. */
const argPlaceholderSchema = z
  .string()
  .regex(/^\$([0-9]|ARGUMENTS)$/, 'placeholder must be $0..$9 or $ARGUMENTS');

// ---------------------------------------------------------------------------
// Triggers (graph entry points)
// ---------------------------------------------------------------------------

export const slashCommandDataSchema = z.object({
  name: z.string(),
  description: z.string(),
  argumentHint: z.string().optional(),
  args: z
    .array(z.object({ name: z.string(), placeholder: argPlaceholderSchema }))
    .optional(),
  disableModelInvocation: z.boolean().optional(),
  contextFork: z.boolean().optional(),
  agent: z.string().optional(), // subagent name this command delegates to
  model: z.string().optional(),
  effort: effortSchema.optional(),
  // Unknown frontmatter keys preserved on import, re-emitted verbatim.
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const hookEventDataSchema = z.object({
  event: hookEventSchema,
  matcher: z.string().optional(),
  scope: z.enum(['user', 'project', 'local']),
});

export const sessionStartDataSchema = z.object({
  matcher: z.enum(['startup', 'resume', 'clear', 'compact', 'fork']),
});

export const headlessDataSchema = z.object({
  promptTemplate: z.string(),
  schedule: z.string().optional(), // cron string, doc-only
  initMode: z.enum(['init', 'init-only', 'maintenance']).optional(),
});

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export const promptStepDataSchema = z.object({
  body: z.string(),
  model: z.string().optional(),
  effort: effortSchema.optional(),
});

export const shellStepDataSchema = z.object({
  command: z.string(),
  embedOutput: z.boolean().optional(), // true → !`cmd` in skill body; false → standalone script
  scriptBody: z.string().optional(),
});

export const fileRefStepDataSchema = z.object({
  paths: z.array(z.string()),
});

export const subagentStepDataSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  tools: z.array(z.string()).optional(),
  model: z.string().optional(),
  effort: effortSchema.optional(),
  systemPrompt: z.string(),
  // Hook events declared in the agent's own frontmatter (see REFERENCE: Stop
  // auto-converts to SubagentStop). Modeled to drive CF303.
  frontmatterHooks: z.array(hookEventSchema).optional(),
  // Unknown frontmatter keys preserved on import, re-emitted verbatim.
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const mcpToolStepDataSchema = z.object({
  server: z.string(),
  tool: z.string(),
  input: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Hook handlers
// ---------------------------------------------------------------------------

export const commandHandlerDataSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(), // exec form (preferred with path placeholders)
  shell: z.enum(['bash', 'powershell']).optional(),
  timeout: z.number().optional(),
  statusMessage: z.string().optional(),
  async: z.boolean().optional(),
  asyncRewake: z.boolean().optional(),
  once: z.boolean().optional(),
  if: z.string().optional(), // one permission-rule string
  scriptBody: z.string().optional(), // inline script → .claude/hooks/<file>.sh
});

export const httpHandlerDataSchema = z.object({
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  allowedEnvVars: z.array(z.string()).optional(),
  timeout: z.number().optional(),
});

export const promptHandlerDataSchema = z.object({
  prompt: z.string(),
  model: z.string().optional(),
});

export const agentHandlerDataSchema = z.object({
  prompt: z.string(),
  model: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Control / output
// ---------------------------------------------------------------------------

export const gateConditionDataSchema = z.object({
  matcher: z.string().optional(),
  if: z.string().optional(),
});

export const decisionDataSchema = z.object({
  mode: z.enum(['allow', 'deny', 'ask', 'block', 'stopAll']),
  reason: z.string().optional(),
  updatedInput: z.record(z.string(), z.unknown()).optional(),
  updatedToolOutput: z.record(z.string(), z.unknown()).optional(),
  additionalContext: z.string().optional(),
  systemMessage: z.string().optional(),
  suppressOutput: z.boolean().optional(),
  // How a blocking decision is emitted (SPEC-CODEGEN decision table: "user picks
  // style; default JSON"). 'exit1' represents the misconfiguration CF114 flags.
  blockStyle: z.enum(['json', 'exit2', 'exit1']).optional(),
});

// ---------------------------------------------------------------------------
// Node union (discriminated on `kind`)
// ---------------------------------------------------------------------------

const nodeBase = { id: z.string(), label: z.string(), position: positionSchema };

function node<K extends string, D extends z.ZodTypeAny>(kind: K, data: D) {
  return z.object({ ...nodeBase, kind: z.literal(kind), data });
}

export const workflowNodeSchema = z.discriminatedUnion('kind', [
  node('trigger.slashCommand', slashCommandDataSchema),
  node('trigger.hookEvent', hookEventDataSchema),
  node('trigger.sessionStart', sessionStartDataSchema),
  node('trigger.headless', headlessDataSchema),
  node('step.prompt', promptStepDataSchema),
  node('step.shell', shellStepDataSchema),
  node('step.fileRef', fileRefStepDataSchema),
  node('step.subagent', subagentStepDataSchema),
  node('step.mcpTool', mcpToolStepDataSchema),
  node('hook.command', commandHandlerDataSchema),
  node('hook.http', httpHandlerDataSchema),
  node('hook.prompt', promptHandlerDataSchema),
  node('hook.agent', agentHandlerDataSchema),
  node('gate.condition', gateConditionDataSchema),
  node('output.decision', decisionDataSchema),
]);

export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type NodeKind = WorkflowNode['kind'];

/** All node kinds, for exhaustiveness checks and edge-compatibility tables. */
export const NODE_KINDS = [
  'trigger.slashCommand', 'trigger.hookEvent', 'trigger.sessionStart', 'trigger.headless',
  'step.prompt', 'step.shell', 'step.fileRef', 'step.subagent', 'step.mcpTool',
  'hook.command', 'hook.http', 'hook.prompt', 'hook.agent',
  'gate.condition', 'output.decision',
] as const satisfies readonly NodeKind[];

// Narrowed data types (handy for rule code).
export type SlashCommandData = z.infer<typeof slashCommandDataSchema>;
export type HookEventData = z.infer<typeof hookEventDataSchema>;
export type SessionStartData = z.infer<typeof sessionStartDataSchema>;
export type HeadlessData = z.infer<typeof headlessDataSchema>;
export type PromptStepData = z.infer<typeof promptStepDataSchema>;
export type ShellStepData = z.infer<typeof shellStepDataSchema>;
export type FileRefStepData = z.infer<typeof fileRefStepDataSchema>;
export type SubagentStepData = z.infer<typeof subagentStepDataSchema>;
export type McpToolStepData = z.infer<typeof mcpToolStepDataSchema>;
export type CommandHandlerData = z.infer<typeof commandHandlerDataSchema>;
export type HttpHandlerData = z.infer<typeof httpHandlerDataSchema>;
export type PromptHandlerData = z.infer<typeof promptHandlerDataSchema>;
export type AgentHandlerData = z.infer<typeof agentHandlerDataSchema>;
export type GateConditionData = z.infer<typeof gateConditionDataSchema>;
export type DecisionData = z.infer<typeof decisionDataSchema>;

/** Type guard: narrow a node to a specific kind. */
export function isKind<K extends NodeKind>(
  n: WorkflowNode,
  kind: K,
): n is Extract<WorkflowNode, { kind: K }> {
  return n.kind === kind;
}
