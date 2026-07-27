// Hit + miss fixture graphs for every rule CF001–CF504.
// - "hit"  MUST produce a diagnostic with the rule's id.
// - "miss" MUST NOT produce a diagnostic with the rule's id.
// test/validation-matrix.test.ts asserts every documented rule has both fixtures.
import type { RuleId } from '../src/schema/types.js';
import type { WorkflowGraph, Edge } from '../src/schema/graph.js';
import type {
  WorkflowNode,
  SlashCommandData,
  HookEventData,
  SessionStartData,
  HeadlessData,
  PromptStepData,
  ShellStepData,
  FileRefStepData,
  SubagentStepData,
  McpToolStepData,
  CommandHandlerData,
  HttpHandlerData,
  PromptHandlerData,
  AgentHandlerData,
  GateConditionData,
  DecisionData,
} from '../src/schema/nodes.js';

const pos = { x: 0, y: 0 };

// --- typed node factories ----------------------------------------------------

export const n = {
  cmd: (id: string, data: SlashCommandData): WorkflowNode => ({
    id, kind: 'trigger.slashCommand', label: id, position: pos, data,
  }),
  hookEvent: (id: string, data: HookEventData): WorkflowNode => ({
    id, kind: 'trigger.hookEvent', label: id, position: pos, data,
  }),
  sessionStart: (id: string, data: SessionStartData): WorkflowNode => ({
    id, kind: 'trigger.sessionStart', label: id, position: pos, data,
  }),
  headless: (id: string, data: HeadlessData): WorkflowNode => ({
    id, kind: 'trigger.headless', label: id, position: pos, data,
  }),
  prompt: (id: string, data: PromptStepData): WorkflowNode => ({
    id, kind: 'step.prompt', label: id, position: pos, data,
  }),
  shell: (id: string, data: ShellStepData): WorkflowNode => ({
    id, kind: 'step.shell', label: id, position: pos, data,
  }),
  fileRef: (id: string, data: FileRefStepData): WorkflowNode => ({
    id, kind: 'step.fileRef', label: id, position: pos, data,
  }),
  subagent: (id: string, data: SubagentStepData): WorkflowNode => ({
    id, kind: 'step.subagent', label: id, position: pos, data,
  }),
  mcpTool: (id: string, data: McpToolStepData): WorkflowNode => ({
    id, kind: 'step.mcpTool', label: id, position: pos, data,
  }),
  command: (id: string, data: CommandHandlerData): WorkflowNode => ({
    id, kind: 'hook.command', label: id, position: pos, data,
  }),
  http: (id: string, data: HttpHandlerData): WorkflowNode => ({
    id, kind: 'hook.http', label: id, position: pos, data,
  }),
  promptHandler: (id: string, data: PromptHandlerData): WorkflowNode => ({
    id, kind: 'hook.prompt', label: id, position: pos, data,
  }),
  agentHandler: (id: string, data: AgentHandlerData): WorkflowNode => ({
    id, kind: 'hook.agent', label: id, position: pos, data,
  }),
  gate: (id: string, data: GateConditionData): WorkflowNode => ({
    id, kind: 'gate.condition', label: id, position: pos, data,
  }),
  decision: (id: string, data: DecisionData): WorkflowNode => ({
    id, kind: 'output.decision', label: id, position: pos, data,
  }),
};

export function e(source: string, target: string): Edge {
  return { id: `${source}->${target}`, source, target };
}

export function g(
  nodes: WorkflowNode[],
  edges: Edge[] = [],
  settings: WorkflowGraph['settings'] = {},
  meta: Partial<WorkflowGraph['meta']> = {},
): WorkflowGraph {
  return { version: 1, meta: { name: 'T', slug: 't', ...meta }, settings, nodes, edges };
}

/** A minimal always-valid command trigger, used as scaffolding in fixtures. */
export function baseCmd(name = 'do-thing'): WorkflowNode {
  return n.cmd('c1', { name, description: 'Does a well-described thing for tests.' });
}

// -----------------------------------------------------------------------------
// Fixture table. Each entry: a graph that triggers the rule (hit) and one that
// does not (miss). Both are otherwise as minimal as possible.
// -----------------------------------------------------------------------------

export const fixtures: Record<RuleId, { hit: WorkflowGraph; miss: WorkflowGraph }> = {
  // --- graph structure -------------------------------------------------------
  CF001: {
    hit: g([n.prompt('p1', { body: 'hi' })]),
    miss: g([baseCmd()]),
  },
  CF002: {
    hit: g([n.cmd('a', { name: 'a', description: 'first command here ok' }),
            n.cmd('b', { name: 'b', description: 'second command here ok' })]),
    miss: g([baseCmd()]),
  },
  CF003: {
    hit: g(
      [baseCmd(), n.prompt('p1', { body: 'x' }), n.prompt('p2', { body: 'y' })],
      [e('c1', 'p1'), e('p1', 'p2'), e('p2', 'p1')],
    ),
    miss: g([baseCmd(), n.prompt('p1', { body: 'x' })], [e('c1', 'p1')]),
  },
  CF004: {
    hit: g([baseCmd(), n.prompt('orphan', { body: 'x' })]),
    miss: g([baseCmd(), n.prompt('p1', { body: 'x' })], [e('c1', 'p1')]),
  },
  CF005: {
    hit: g([baseCmd(), n.command('h1', { command: 'echo' })], [e('c1', 'h1')]),
    miss: g([baseCmd(), n.prompt('p1', { body: 'x' })], [e('c1', 'p1')]),
  },
  CF006: {
    hit: g([n.cmd('c1', { name: 'x', description: '' })]),
    miss: g([baseCmd()]),
  },
  CF007: {
    hit: g([n.cmd('c1', { name: 'dup', description: 'command number one here' }),
            n.subagent('s1', { name: 'dup', systemPrompt: 'do', description: 'agent' })]),
    miss: g([n.cmd('c1', { name: 'uno', description: 'command number one here' }),
             n.subagent('s1', { name: 'dos', systemPrompt: 'do', description: 'agent' })],
            [e('c1', 's1')]),
  },
  CF008: {
    hit: g([n.cmd('c1', { name: 'code-review', description: 'shadows a bundled skill here' })]),
    miss: g([baseCmd()]),
  },
  // --- hooks -----------------------------------------------------------------
  CF101: {
    hit: g(
      [n.hookEvent('t1', { event: 'Notification', scope: 'project' }),
       n.command('h1', { command: 'echo' }),
       n.decision('d1', { mode: 'block' })],
      [e('t1', 'h1'), e('h1', 'd1')],
    ),
    miss: g(
      [n.hookEvent('t1', { event: 'PreToolUse', scope: 'project', matcher: 'Bash' }),
       n.command('h1', { command: 'echo' }),
       n.decision('d1', { mode: 'block' })],
      [e('t1', 'h1'), e('h1', 'd1')],
    ),
  },
  CF102: {
    hit: g(
      [n.hookEvent('t1', { event: 'UserPromptSubmit', scope: 'project' }),
       n.command('h1', { command: 'echo', if: 'Bash(git *)' })],
      [e('t1', 'h1')],
    ),
    miss: g(
      [n.hookEvent('t1', { event: 'PreToolUse', scope: 'project', matcher: 'Bash' }),
       n.command('h1', { command: 'echo', if: 'Bash(git *)' })],
      [e('t1', 'h1')],
    ),
  },
  CF103: {
    hit: g([n.hookEvent('t1', { event: 'UserPromptSubmit', scope: 'project', matcher: 'Bash' })]),
    miss: g([n.hookEvent('t1', { event: 'PreToolUse', scope: 'project', matcher: 'Bash' })]),
  },
  CF104: {
    hit: g([n.hookEvent('t1', { event: 'PreToolUse', scope: 'project', matcher: 'mcp__github' })]),
    miss: g([n.hookEvent('t1', { event: 'PreToolUse', scope: 'project', matcher: 'mcp__github__.*' })]),
  },
  CF105: {
    hit: g([n.hookEvent('t1', { event: 'PreToolUse', scope: 'project', matcher: 'Edit.*' })]),
    miss: g([n.hookEvent('t1', { event: 'PreToolUse', scope: 'project', matcher: '^Edit$' })]),
  },
  CF106: {
    hit: g(
      [n.hookEvent('t1', { event: 'PreToolUse', scope: 'project', matcher: 'Bash' }),
       n.command('h1', { command: '${CLAUDE_PROJECT_DIR}/.claude/hooks/x.sh' })],
      [e('t1', 'h1')],
    ),
    miss: g(
      [n.hookEvent('t1', { event: 'PreToolUse', scope: 'project', matcher: 'Bash' }),
       n.command('h1', { command: '${CLAUDE_PROJECT_DIR}/.claude/hooks/x.sh', args: [] })],
      [e('t1', 'h1')],
    ),
  },
  CF107: {
    hit: g(
      [n.hookEvent('t1', { event: 'PreToolUse', scope: 'project', matcher: 'Bash' }),
       n.command('h1', { command: 'echo', once: true })],
      [e('t1', 'h1')],
    ),
    miss: g(
      [n.hookEvent('t1', { event: 'PreToolUse', scope: 'project', matcher: 'Bash' }),
       n.command('h1', { command: 'echo' })],
      [e('t1', 'h1')],
    ),
  },
  CF108: {
    hit: g(
      [n.hookEvent('t1', { event: 'UserPromptSubmit', scope: 'project' }),
       n.command('h1', { command: 'echo', timeout: 120 })],
      [e('t1', 'h1')],
    ),
    miss: g(
      [n.hookEvent('t1', { event: 'UserPromptSubmit', scope: 'project' }),
       n.command('h1', { command: 'echo', timeout: 20 })],
      [e('t1', 'h1')],
    ),
  },
  CF109: {
    hit: g(
      [n.hookEvent('t1', { event: 'MessageDisplay', scope: 'project' }),
       n.command('h1', { command: 'echo', timeout: 30 })],
      [e('t1', 'h1')],
    ),
    miss: g(
      [n.hookEvent('t1', { event: 'MessageDisplay', scope: 'project' }),
       n.command('h1', { command: 'echo', timeout: 5 })],
      [e('t1', 'h1')],
    ),
  },
  CF110: {
    hit: g(
      [n.hookEvent('t1', { event: 'PreToolUse', scope: 'project', matcher: 'Bash' }),
       n.agentHandler('a1', { prompt: 'inspect' })],
      [e('t1', 'a1')],
    ),
    miss: g(
      [n.hookEvent('t1', { event: 'PreToolUse', scope: 'project', matcher: 'Bash' }),
       n.command('h1', { command: 'echo' })],
      [e('t1', 'h1')],
    ),
  },
  CF111: {
    hit: g(
      [n.hookEvent('t1', { event: 'SessionStart', scope: 'project' }),
       n.http('h1', { url: 'https://example.com' })],
      [e('t1', 'h1')],
    ),
    miss: g(
      [n.hookEvent('t1', { event: 'SessionStart', scope: 'project' }),
       n.command('h1', { command: 'echo' })],
      [e('t1', 'h1')],
    ),
  },
  CF112: {
    hit: g(
      [n.hookEvent('t1', { event: 'SessionStart', scope: 'project' }),
       n.mcpTool('m1', { server: 'github', tool: 'list' })],
      [e('t1', 'm1')],
    ),
    miss: g(
      [n.hookEvent('t1', { event: 'PostToolUse', scope: 'project', matcher: 'Bash' }),
       n.mcpTool('m1', { server: 'github', tool: 'list' })],
      [e('t1', 'm1')],
    ),
  },
  CF113: {
    hit: g(
      [n.hookEvent('t1', { event: 'PermissionDenied', scope: 'project' }),
       n.command('h1', { command: 'echo' }),
       n.decision('d1', { mode: 'block', blockStyle: 'exit2' })],
      [e('t1', 'h1'), e('h1', 'd1')],
    ),
    miss: g(
      [n.hookEvent('t1', { event: 'PermissionDenied', scope: 'project' }),
       n.command('h1', { command: 'echo' }),
       n.decision('d1', { mode: 'ask', blockStyle: 'json' })],
      [e('t1', 'h1'), e('h1', 'd1')],
    ),
  },
  CF114: {
    hit: g(
      [n.hookEvent('t1', { event: 'PreToolUse', scope: 'project', matcher: 'Bash' }),
       n.command('h1', { command: 'echo' }),
       n.decision('d1', { mode: 'block', blockStyle: 'exit1' })],
      [e('t1', 'h1'), e('h1', 'd1')],
    ),
    miss: g(
      [n.hookEvent('t1', { event: 'PreToolUse', scope: 'project', matcher: 'Bash' }),
       n.command('h1', { command: 'echo' }),
       n.decision('d1', { mode: 'block', blockStyle: 'exit2' })],
      [e('t1', 'h1'), e('h1', 'd1')],
    ),
  },
  CF115: {
    hit: g(
      [n.hookEvent('t1', { event: 'PreToolUse', scope: 'project', matcher: 'Bash' }),
       n.command('h1', { command: 'bash', scriptBody: '#!/bin/bash\necho hi\n' })],
      [e('t1', 'h1')],
    ),
    miss: g(
      [n.hookEvent('t1', { event: 'PreToolUse', scope: 'project', matcher: 'Bash' }),
       n.command('h1', {
         command: 'bash',
         scriptBody: 'command -v jq >/dev/null || exit 1\ninput=$(cat)\necho "$input"\n',
       })],
      [e('t1', 'h1')],
    ),
  },
  // --- skills / commands -----------------------------------------------------
  CF201: {
    hit: g([n.cmd('c1', { name: 'x', description: 'uses a positional arg here' }),
            n.prompt('p1', { body: 'Handle $1 now' })], [e('c1', 'p1')]),
    miss: g([n.cmd('c1', {
      name: 'x', description: 'uses a positional arg here',
      args: [{ name: 'first', placeholder: '$1' }],
    }), n.prompt('p1', { body: 'Handle $1 now' })], [e('c1', 'p1')]),
  },
  CF202: {
    hit: g([n.cmd('c1', {
      name: 'x', description: 'has args but no hint here',
      args: [{ name: 'first', placeholder: '$1' }],
    })]),
    miss: g([n.cmd('c1', {
      name: 'x', description: 'has args and a hint here',
      argumentHint: '[first]',
      args: [{ name: 'first', placeholder: '$1' }],
    })]),
  },
  CF203: {
    hit: g([baseCmd(), n.shell('s1', { command: 'git status', embedOutput: true })],
           [e('c1', 's1')]),
    miss: g([baseCmd(), n.shell('s1', { command: 'git status', embedOutput: true })],
            [e('c1', 's1')],
            { permissions: { allow: ['Bash(git *)'], deny: [], ask: [] } }),
  },
  CF204: {
    hit: g([n.cmd('c1', { name: 'x', description: 'x'.repeat(220) })]),
    miss: g([baseCmd()]),
  },
  CF205: {
    hit: g([n.cmd('c1', { name: 'x', description: 'delegates to a missing agent', agent: 'ghost' })]),
    miss: g([n.cmd('c1', { name: 'x', description: 'delegates to a real agent', agent: 'real' }),
             n.subagent('s1', { name: 'real', systemPrompt: 'do', description: 'the agent' })],
            [e('c1', 's1')]),
  },
  CF206: {
    hit: g([n.cmd('c1', { name: 'x', description: 'short', disableModelInvocation: true })]),
    miss: g([n.cmd('c1', {
      name: 'x', description: 'A clear, specific description of what this does.',
      disableModelInvocation: true,
    })]),
  },
  CF207: {
    hit: g([n.cmd('c1', { name: 'gen', description: 'references its own output' }),
            n.fileRef('f1', { paths: ['.claude/skills/gen/SKILL.md'] })], [e('c1', 'f1')]),
    miss: g([n.cmd('c1', { name: 'gen', description: 'references an external doc' }),
             n.fileRef('f1', { paths: ['docs/README.md'] })], [e('c1', 'f1')]),
  },
  // --- subagents -------------------------------------------------------------
  CF301: {
    hit: g([baseCmd(),
            n.subagent('s1', { name: 'a', systemPrompt: 'do', description: 'agent', tools: ['WebFetch'] })],
           [e('c1', 's1')],
           { permissions: { allow: ['Read', 'Grep'], deny: [], ask: [] } }),
    miss: g([baseCmd(),
             n.subagent('s1', { name: 'a', systemPrompt: 'do', description: 'agent', tools: ['Read'] })],
            [e('c1', 's1')],
            { permissions: { allow: ['Read', 'Grep'], deny: [], ask: [] } }),
  },
  CF302: {
    hit: g([baseCmd(), n.subagent('s1', { name: 'a', systemPrompt: 'do' })], [e('c1', 's1')]),
    miss: g([baseCmd(), n.subagent('s1', { name: 'a', systemPrompt: 'do', description: 'the agent' })],
            [e('c1', 's1')]),
  },
  CF303: {
    hit: g([baseCmd(),
            n.subagent('s1', { name: 'a', systemPrompt: 'do', description: 'agent', frontmatterHooks: ['Stop'] })],
           [e('c1', 's1')]),
    miss: g([baseCmd(),
             n.subagent('s1', { name: 'a', systemPrompt: 'do', description: 'agent', frontmatterHooks: ['SubagentStop'] })],
            [e('c1', 's1')]),
  },
  // --- settings / model / effort ---------------------------------------------
  CF401: {
    hit: g([baseCmd()], [], { effort: 'max' }),
    miss: g([baseCmd()], [], { effort: 'high' }),
  },
  CF402: {
    hit: g([baseCmd()], [], { model: 'haiku', effort: 'max' }),
    miss: g([baseCmd()], [], { model: 'opus', effort: 'max' }),
  },
  CF403: {
    hit: g([baseCmd()], [], { model: 'gpt-4o' }),
    miss: g([baseCmd()], [], { model: 'sonnet' }),
  },
  CF404: {
    hit: g([baseCmd()], [], { permissionMode: 'bypassPermissions' }),
    miss: g([baseCmd()], [], { permissionMode: 'default' }),
  },
  CF405: {
    hit: g([baseCmd()], [], { permissions: { allow: ['Bash('], deny: [], ask: [] } }),
    miss: g([baseCmd()], [], { permissions: { allow: ['Bash(git *)'], deny: [], ask: [] } }),
  },
  CF406: {
    hit: g([baseCmd()], [], { permissions: { allow: ['Bash'], deny: ['Bash(rm -rf *)'], ask: [] } }),
    miss: g([baseCmd()], [], { permissions: { allow: ['Read'], deny: ['Bash(rm -rf *)'], ask: [] } }),
  },
  CF407: {
    hit: g([baseCmd()], [], { env: { 'OTEL_ENABLED': '1' } }),
    miss: g([baseCmd()], [], { env: { MY_VAR: '1' } }),
  },
  // --- headless / runner -----------------------------------------------------
  CF501: {
    hit: g([n.headless('h1', { promptTemplate: '' })]),
    miss: g([n.headless('h1', { promptTemplate: 'Do the thing.' })]),
  },
  CF502: {
    hit: g([baseCmd()], [], { headless: { enabled: true, outputFormat: 'stream-json' } }),
    miss: g([baseCmd()], [], { headless: { enabled: true, outputFormat: 'json' } }),
  },
  CF503: {
    hit: g([baseCmd(), n.prompt('p1', { body: 'a' }), n.prompt('p2', { body: 'b' }),
            n.prompt('p3', { body: 'c' })],
           [e('c1', 'p1'), e('p1', 'p2'), e('p2', 'p3')],
           { headless: { enabled: true, maxTurns: 2 } }),
    miss: g([baseCmd(), n.prompt('p1', { body: 'a' })],
            [e('c1', 'p1')],
            { headless: { enabled: true, maxTurns: 20 } }),
  },
  CF504: {
    hit: g([baseCmd()], [], { headless: { enabled: true, worktree: true } }),
    miss: g([baseCmd()], [], { headless: { enabled: true, worktree: false } }),
  },
};
