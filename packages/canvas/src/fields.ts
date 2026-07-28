// Data-driven property-panel field descriptors. One table per node kind lists
// EVERY data field (DoD requirement), grouped Basic / Advanced (DESIGN-BRIEF).
// The React PropertyPanel renders these generically, so adding a schema field =
// adding a row here (no bespoke component). Field keys match the zod data schema.
import type { NodeKind } from '@clauflow/core';

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'select'
  | 'model' // model picker (known aliases + free text)
  | 'effort'
  | 'stringList' // comma/newline list → string[]
  | 'matcher' // tool matcher with syntax help
  | 'permissionRule'; // e.g. Bash(git *)

export interface FieldDescriptor {
  /** Data key (dotted allowed for nested, but M2 fields are flat). */
  key: string;
  label: string;
  type: FieldType;
  group: 'Basic' | 'Advanced';
  /** Human help — copy names things by what users control (DESIGN-BRIEF). */
  hint?: string;
  options?: readonly string[]; // for select
  placeholder?: string;
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

// Common model/effort rows reused by several kinds.
const MODEL: FieldDescriptor = { key: 'model', label: 'Model', type: 'model', group: 'Advanced', hint: 'Alias (sonnet, opus) or full id. Blank = inherit.' };
const EFFORT: FieldDescriptor = { key: 'effort', label: 'Effort', type: 'effort', group: 'Advanced', options: EFFORTS, hint: 'xhigh/max run via the CLI flag, not settings.json.' };

export const FIELD_DESCRIPTORS: Record<NodeKind, FieldDescriptor[]> = {
  'trigger.slashCommand': [
    { key: 'name', label: 'Command name', type: 'text', group: 'Basic', hint: 'Becomes /<name> and the skill folder.' },
    { key: 'description', label: 'Description', type: 'textarea', group: 'Basic', hint: 'Shown to Claude for auto-invocation; keep it tight.' },
    { key: 'argumentHint', label: 'Argument hint', type: 'text', group: 'Basic', placeholder: '[issue] [priority]' },
    { key: 'disableModelInvocation', label: 'Manual-only (no auto-invoke)', type: 'boolean', group: 'Advanced' },
    { key: 'contextFork', label: 'Run in a forked context', type: 'boolean', group: 'Advanced' },
    { key: 'agent', label: 'Delegate to subagent', type: 'text', group: 'Advanced', hint: 'Name of a subagent node to hand the whole command to.' },
    MODEL,
    EFFORT,
  ],
  'trigger.hookEvent': [
    { key: 'event', label: 'Event', type: 'text', group: 'Basic', hint: 'Lifecycle event, e.g. PreToolUse.' },
    { key: 'matcher', label: 'Matcher', type: 'matcher', group: 'Basic', hint: 'Tool name / list / regex. For MCP use mcp__server__.*' },
    { key: 'scope', label: 'Scope', type: 'select', group: 'Advanced', options: ['project', 'user', 'local'], hint: 'local → settings.local.json (machine-specific).' },
  ],
  'trigger.sessionStart': [
    { key: 'matcher', label: 'Fires on', type: 'select', group: 'Basic', options: ['startup', 'resume', 'clear', 'compact', 'fork'] },
  ],
  'trigger.headless': [
    { key: 'promptTemplate', label: 'Prompt', type: 'textarea', group: 'Basic', hint: 'The claude -p prompt. Supports $ARGUMENTS, $0..$9.' },
    { key: 'initMode', label: 'Init mode', type: 'select', group: 'Advanced', options: ['init', 'init-only', 'maintenance'] },
    { key: 'schedule', label: 'Schedule (doc-only)', type: 'text', group: 'Advanced', placeholder: '0 9 * * 1' },
  ],
  'step.prompt': [
    { key: 'body', label: 'Prompt body', type: 'textarea', group: 'Basic', hint: 'Markdown. Placeholders $ARGUMENTS, $0..$9 are preserved.' },
    MODEL,
    EFFORT,
  ],
  'step.shell': [
    { key: 'command', label: 'Command', type: 'text', group: 'Basic', hint: 'Shell command to run.' },
    { key: 'embedOutput', label: 'Embed output in prompt', type: 'boolean', group: 'Basic', hint: 'On → !`cmd` under a Context heading. Off → standalone script.' },
    { key: 'scriptBody', label: 'Script body', type: 'textarea', group: 'Advanced', hint: 'For standalone scripts.' },
  ],
  'step.fileRef': [
    { key: 'paths', label: 'File paths', type: 'stringList', group: 'Basic', hint: 'One per line → @path references.' },
  ],
  'step.subagent': [
    { key: 'name', label: 'Subagent name', type: 'text', group: 'Basic', hint: 'Becomes .claude/agents/<name>.md.' },
    { key: 'description', label: 'Description', type: 'textarea', group: 'Basic', hint: 'When Claude should delegate to it (required to auto-delegate).' },
    { key: 'systemPrompt', label: 'System prompt', type: 'textarea', group: 'Basic' },
    { key: 'tools', label: 'Allowed tools', type: 'stringList', group: 'Advanced', hint: 'Blank = inherit all.' },
    MODEL,
    EFFORT,
  ],
  'step.mcpTool': [
    { key: 'server', label: 'MCP server', type: 'text', group: 'Basic', hint: 'Plugin-scoped: plugin:<plugin>:<server>.' },
    { key: 'tool', label: 'Tool', type: 'text', group: 'Basic' },
  ],
  'hook.command': [
    { key: 'command', label: 'Command', type: 'text', group: 'Basic', hint: 'Use exec form (args) when a path placeholder is involved.' },
    { key: 'args', label: 'Args (exec form)', type: 'stringList', group: 'Basic' },
    { key: 'scriptBody', label: 'Inline script', type: 'textarea', group: 'Basic', hint: 'Inner logic only — codegen adds the shebang, jq guard and stdin read.' },
    { key: 'timeout', label: 'Timeout (s)', type: 'number', group: 'Advanced' },
    { key: 'statusMessage', label: 'Status message', type: 'text', group: 'Advanced' },
    { key: 'shell', label: 'Shell', type: 'select', group: 'Advanced', options: ['bash', 'powershell'] },
    { key: 'async', label: 'Run async', type: 'boolean', group: 'Advanced' },
    { key: 'asyncRewake', label: 'Rewake when async completes', type: 'boolean', group: 'Advanced' },
    { key: 'once', label: 'Once per session', type: 'boolean', group: 'Advanced', hint: 'Only honoured in skill frontmatter (ignored on settings.json hooks).' },
    { key: 'if', label: 'Condition (permission rule)', type: 'permissionRule', group: 'Advanced', hint: 'Tool events only, e.g. Bash(git *).' },
  ],
  'hook.http': [
    { key: 'url', label: 'URL', type: 'text', group: 'Basic' },
    { key: 'headers', label: 'Headers', type: 'textarea', group: 'Advanced', hint: 'key: value per line.' },
    { key: 'allowedEnvVars', label: 'Allowed env vars', type: 'stringList', group: 'Advanced' },
    { key: 'timeout', label: 'Timeout (s)', type: 'number', group: 'Advanced' },
  ],
  'hook.prompt': [
    { key: 'prompt', label: 'Prompt', type: 'textarea', group: 'Basic', hint: '$ARGUMENTS is the input JSON.' },
    MODEL,
  ],
  'hook.agent': [
    { key: 'prompt', label: 'Prompt', type: 'textarea', group: 'Basic' },
    MODEL,
  ],
  'gate.condition': [
    { key: 'matcher', label: 'Matcher', type: 'matcher', group: 'Basic' },
    { key: 'if', label: 'Condition', type: 'permissionRule', group: 'Basic', hint: 'e.g. Bash(git *), Edit(*.ts).' },
  ],
  'output.decision': [
    { key: 'mode', label: 'Decision', type: 'select', group: 'Basic', options: ['allow', 'deny', 'ask', 'block', 'stopAll'], hint: 'What the hook tells Claude to do.' },
    { key: 'reason', label: 'Reason', type: 'textarea', group: 'Basic', hint: 'Shown to Claude / the user.' },
    { key: 'additionalContext', label: 'Additional context', type: 'textarea', group: 'Advanced' },
    { key: 'systemMessage', label: 'System message', type: 'text', group: 'Advanced' },
    { key: 'suppressOutput', label: 'Suppress output', type: 'boolean', group: 'Advanced' },
    { key: 'blockStyle', label: 'Block style', type: 'select', group: 'Advanced', options: ['json', 'exit2', 'exit1'], hint: 'How a blocking decision is emitted; default JSON.' },
  ],
};

/** Palette entries grouped as in DESIGN-BRIEF (Triggers / Steps / Hooks / Control). */
export interface PaletteEntry {
  kind: NodeKind;
  label: string;
}
export const PALETTE: { group: string; entries: PaletteEntry[] }[] = [
  {
    group: 'Triggers',
    entries: [
      { kind: 'trigger.slashCommand', label: 'Slash command' },
      { kind: 'trigger.hookEvent', label: 'Hook event' },
      { kind: 'trigger.sessionStart', label: 'Session start' },
      { kind: 'trigger.headless', label: 'Headless runner' },
    ],
  },
  {
    group: 'Steps',
    entries: [
      { kind: 'step.prompt', label: 'Prompt' },
      { kind: 'step.shell', label: 'Shell' },
      { kind: 'step.fileRef', label: 'File refs' },
      { kind: 'step.subagent', label: 'Subagent' },
      { kind: 'step.mcpTool', label: 'MCP tool' },
    ],
  },
  {
    group: 'Hooks',
    entries: [
      { kind: 'hook.command', label: 'Command hook' },
      { kind: 'hook.http', label: 'HTTP hook' },
      { kind: 'hook.prompt', label: 'Prompt hook' },
      { kind: 'hook.agent', label: 'Agent hook' },
    ],
  },
  {
    group: 'Control',
    entries: [
      { kind: 'gate.condition', label: 'Gate' },
      { kind: 'output.decision', label: 'Decision' },
    ],
  },
];

/** A blank data object for a freshly-created node of a kind (schema-valid defaults). */
export function defaultData(kind: NodeKind): Record<string, unknown> {
  switch (kind) {
    case 'trigger.slashCommand':
      return { name: 'command', description: '' };
    case 'trigger.hookEvent':
      return { event: 'PreToolUse', scope: 'project' };
    case 'trigger.sessionStart':
      return { matcher: 'startup' };
    case 'trigger.headless':
      return { promptTemplate: '' };
    case 'step.prompt':
      return { body: '' };
    case 'step.shell':
      return { command: '' };
    case 'step.fileRef':
      return { paths: [] };
    case 'step.subagent':
      return { name: 'agent', systemPrompt: '' };
    case 'step.mcpTool':
      return { server: '', tool: '' };
    case 'hook.command':
      return { command: '' };
    case 'hook.http':
      return { url: '' };
    case 'hook.prompt':
      return { prompt: '' };
    case 'hook.agent':
      return { prompt: '' };
    case 'gate.condition':
      return {};
    case 'output.decision':
      return { mode: 'allow' };
  }
}
