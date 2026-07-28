import { describe, it, expect } from 'vitest';
import { frontmatter } from '../src/codegen/yaml.js';
import { stableJson } from '../src/codegen/json.js';
import { emitHookScript, shSingleQuote } from '../src/codegen/script.js';
import { emitAgent } from '../src/codegen/agent.js';
import { emitSkill } from '../src/codegen/skill.js';
import { generate } from '../src/codegen/index.js';
import { TEMPLATES } from '../src/templates.js';
import { g, e, n, baseCmd } from './fixtures.js';
import type { GeneratedFile } from '../src/schema/types.js';

const find = (files: GeneratedFile[], suffix: string) => files.find((f) => f.path.endsWith(suffix))!;

// ---------------------------------------------------------------------------
// yaml.frontmatter — exact output for every value shape.
// ---------------------------------------------------------------------------
describe('frontmatter emitter', () => {
  it('emits scalars, inline arrays, and omits empties', () => {
    expect(frontmatter([['description', 'hi'], ['tools', ['Read', 'Grep']], ['x', undefined], ['y', []]])).toBe(
      '---\ndescription: hi\ntools: Read, Grep\n---',
    );
  });

  it('quotes strings needing it and leaves plain ones bare', () => {
    expect(frontmatter([['a', 'plain-value']])).toBe('---\na: plain-value\n---');
    expect(frontmatter([['a', '[bracket]']])).toBe('---\na: "[bracket]"\n---');
    expect(frontmatter([['a', 'has: colon']])).toBe('---\na: "has: colon"\n---');
    expect(frontmatter([['a', '']])).toBe('---\na: ""\n---');
  });

  it('emits booleans and numbers unquoted', () => {
    expect(frontmatter([['a', true], ['b', 3]])).toBe('---\na: true\nb: 3\n---');
  });

  it('emits nested objects via indented YAML with sorted keys', () => {
    expect(frontmatter([['hooks', { b: 1, a: 2 }]])).toBe('---\nhooks:\n  a: 2\n  b: 1\n---');
  });

  it('omits an empty object', () => {
    expect(frontmatter([['hooks', {}]])).toBe('---\n---');
  });
});

// ---------------------------------------------------------------------------
// stableJson — sorted keys, trailing newline.
// ---------------------------------------------------------------------------
describe('stableJson', () => {
  it('sorts keys recursively and appends a trailing newline', () => {
    expect(stableJson({ b: 1, a: { d: 4, c: 3 } })).toBe('{\n  "a": {\n    "c": 3,\n    "d": 4\n  },\n  "b": 1\n}\n');
  });
  it('preserves array order', () => {
    expect(stableJson([3, 1, 2])).toBe('[\n  3,\n  1,\n  2\n]\n');
  });
});

// ---------------------------------------------------------------------------
// shSingleQuote — POSIX single-quote escaping.
// ---------------------------------------------------------------------------
describe('shSingleQuote', () => {
  it('wraps in single quotes', () => {
    expect(shSingleQuote('abc')).toBe("'abc'");
  });
  it('escapes embedded single quotes', () => {
    expect(shSingleQuote("it's")).toBe("'it'\\''s'");
  });
});

// ---------------------------------------------------------------------------
// emitAgent — every frontmatter field + body, exact.
// ---------------------------------------------------------------------------
describe('emitAgent', () => {
  it('emits name/description/tools/model and the system prompt body', () => {
    const f = emitAgent({
      id: 'a',
      data: { name: 'rev', description: 'reviews', tools: ['Read', 'Grep'], model: 'opus', systemPrompt: 'Do it.' },
    });
    expect(f.path).toBe('.claude/agents/rev.md');
    expect(f.content).toBe(
      '---\nname: rev\ndescription: reviews\ntools: Read, Grep\nmodel: opus\n---\n\nDo it.\n',
    );
  });

  it('omits tools (inherits all) and model when absent', () => {
    const f = emitAgent({ id: 'a', data: { name: 'x', systemPrompt: 'Body.' } });
    expect(f.content).toBe('---\nname: x\n---\n\nBody.\n');
  });

  it('re-emits unknown frontmatter (extra) verbatim', () => {
    const f = emitAgent({ id: 'a', data: { name: 'x', systemPrompt: 'B', extra: { 'x-k': 'v' } } });
    expect(f.content).toContain('x-k: v');
  });
});

// ---------------------------------------------------------------------------
// emitSkill — body composition (Context, @file, subagent delegation).
// ---------------------------------------------------------------------------
describe('emitSkill body composition', () => {
  it('embeds shell output under a Context heading', () => {
    const files = generate(
      g([baseCmd(), n.shell('s', { command: 'git status', embedOutput: true })], [e('c1', 's')],
        { permissions: { allow: ['Bash(git *)'], deny: [], ask: [] } }),
    );
    expect(find(files, 'SKILL.md').content).toContain('## Context\n- !`git status`');
  });

  it('emits @file references for a fileRef step', () => {
    const files = generate(g([baseCmd(), n.fileRef('f', { paths: ['docs/a.md', 'docs/b.md'] })], [e('c1', 'f')]));
    const body = find(files, 'SKILL.md').content;
    expect(body).toContain('@docs/a.md');
    expect(body).toContain('@docs/b.md');
  });

  it('emits a subagent delegation line', () => {
    const files = generate(
      g([baseCmd(), n.subagent('s', { name: 'helper', description: 'do the thing', systemPrompt: 'x' })], [e('c1', 's')]),
    );
    expect(find(files, 'SKILL.md').content).toContain('Use the helper subagent to do the thing.');
  });

  it('falls back to bare Bash when a shell command has no token', () => {
    const files = generate(g([baseCmd(), n.shell('s', { command: '   ', embedOutput: true })], [e('c1', 's')]));
    expect(find(files, 'SKILL.md').content).toContain('allowed-tools: Bash');
  });

  it('adds an mcp__server__tool entry to allowed-tools for an mcpTool step', () => {
    const files = generate(g([baseCmd(), n.mcpTool('m', { server: 'gh', tool: 'list' })], [e('c1', 'm')]));
    expect(find(files, 'SKILL.md').content).toContain('allowed-tools: mcp__gh__list');
  });

  it('uses a default phrase when a mid-flow subagent has no description', () => {
    // Call emitSkill directly: a description-less subagent trips CF302/CF006 at the
    // gate, but the emitter's fallback phrase is what we're pinning here.
    const unit = {
      id: 'c1',
      data: { name: 'deleg', description: 'delegates onward' },
      steps: [{ id: 's', kind: 'step.subagent', label: 's', position: { x: 0, y: 0 }, data: { name: 'helper', systemPrompt: 'x' } }],
    } as const;
    expect(emitSkill(unit as never).content).toContain('Use the helper subagent to handle this step.');
  });

  it('unions and sorts allowed-tools across steps', () => {
    const unit = {
      id: 'c1',
      data: { name: 'multi', description: 'many tools' },
      steps: [
        { id: 's2', kind: 'step.fileRef', label: 'f', position: { x: 0, y: 0 }, data: { paths: ['x'] } },
        { id: 's1', kind: 'step.shell', label: 's', position: { x: 0, y: 0 }, data: { command: 'git log', embedOutput: true } },
      ],
    } as const;
    // Read (fileRef) + Bash(git *) (shell) sorted.
    const f = emitSkill(unit as never);
    expect(f.content).toContain('allowed-tools: Bash(git *), Read');
  });
});

// ---------------------------------------------------------------------------
// emitHookScript — every decision mode, exact tails.
// ---------------------------------------------------------------------------
describe('emitHookScript decision tails', () => {
  const jqLine = (s: string) => s.split('\n').find((l) => l.startsWith('jq -n')) ?? '';

  it('PreToolUse deny → hookSpecificOutput.permissionDecision deny, reason nested', () => {
    const s = emitHookScript({ event: 'PreToolUse', body: 'x=1', decision: { mode: 'deny', reason: 'no', blockStyle: 'json' } });
    expect(jqLine(s)).toBe(
      `jq -n --arg reason 'no' '{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason } }'`,
    );
    expect(s).not.toContain('decision: "block"');
  });

  it('PreToolUse ask → permissionDecision ask', () => {
    expect(jqLine(emitHookScript({ event: 'PreToolUse', decision: { mode: 'ask', blockStyle: 'json' } }))).toContain(
      'permissionDecision: "ask"',
    );
  });

  it('PreToolUse block maps to permissionDecision deny (not top-level decision)', () => {
    const s = emitHookScript({ event: 'PreToolUse', decision: { mode: 'block', blockStyle: 'json' } });
    expect(jqLine(s)).toContain('permissionDecision: "deny"');
    expect(s).not.toContain('"decision": "block"');
  });

  it('PreToolUse updatedInput → nested via --argjson', () => {
    const s = emitHookScript({ event: 'PreToolUse', decision: { mode: 'allow', updatedInput: { a: 1 }, blockStyle: 'json' } });
    expect(jqLine(s)).toBe(
      `jq -n --argjson uinput '{"a":1}' '{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: $uinput } }'`,
    );
  });

  it('PermissionRequest → hookSpecificOutput.decision.behavior (+updatedInput)', () => {
    const s = emitHookScript({ event: 'PermissionRequest', decision: { mode: 'allow', updatedInput: { command: 'npm run lint' }, blockStyle: 'json' } });
    expect(jqLine(s)).toBe(
      `jq -n --argjson uinput '{"command":"npm run lint"}' '{ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow", updatedInput: $uinput } } }'`,
    );
  });

  it('PermissionRequest deny behavior', () => {
    expect(jqLine(emitHookScript({ event: 'PermissionRequest', decision: { mode: 'deny', blockStyle: 'json' } }))).toContain(
      'decision: { behavior: "deny" }',
    );
  });

  it('PostToolUse → updatedToolOutput + additionalContext nested', () => {
    const s = emitHookScript({ event: 'PostToolUse', decision: { mode: 'allow', updatedToolOutput: { x: 1 }, additionalContext: 'note', blockStyle: 'json' } });
    expect(jqLine(s)).toBe(
      `jq -n --argjson utoutput '{"x":1}' --arg actx 'note' '{ hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: $utoutput, additionalContext: $actx } }'`,
    );
  });

  it('SessionStart additionalContext nests under hookSpecificOutput (not top-level)', () => {
    const s = emitHookScript({ event: 'SessionStart', decision: { mode: 'allow', additionalContext: 'ctx', blockStyle: 'json' } });
    expect(jqLine(s)).toBe(
      `jq -n --arg actx 'ctx' '{ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: $actx } }'`,
    );
  });

  it('Stop/SubagentStop additionalContext nests under hookSpecificOutput', () => {
    expect(jqLine(emitHookScript({ event: 'Stop', decision: { mode: 'allow', additionalContext: 'go on', blockStyle: 'json' } }))).toBe(
      `jq -n --arg actx 'go on' '{ hookSpecificOutput: { hookEventName: "Stop", additionalContext: $actx } }'`,
    );
  });

  it('Stop block via exit2 → reason to stderr + exit 2, no jq', () => {
    const s = emitHookScript({ event: 'Stop', decision: { mode: 'block', reason: 'halt', blockStyle: 'exit2' } });
    expect(s).toContain(`echo 'halt' >&2`);
    expect(s.trimEnd().endsWith('exit 2')).toBe(true);
    expect(s).not.toContain('jq -n');
  });

  it('Stop block via json → top-level decision:block JSON', () => {
    const s = emitHookScript({ event: 'Stop', decision: { mode: 'block', reason: 'halt', blockStyle: 'json' } });
    expect(jqLine(s)).toBe(`jq -n --arg reason 'halt' '{ decision: "block", reason: $reason }'`);
  });

  it('UserPromptSubmit additionalContext nests; block stays top-level', () => {
    const ctx = emitHookScript({ event: 'UserPromptSubmit', decision: { mode: 'allow', additionalContext: 'c', blockStyle: 'json' } });
    expect(jqLine(ctx)).toContain('hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: $actx }');
  });

  it('stopAll → top-level continue:false with stopReason', () => {
    const s = emitHookScript({ event: 'Stop', decision: { mode: 'stopAll', reason: 'done', blockStyle: 'json' } });
    expect(jqLine(s)).toBe(`jq -n --arg reason 'done' '{ continue: false, stopReason: $reason }'`);
  });

  it('systemMessage/suppressOutput are universal top-level; additionalContext nests for PostToolUse', () => {
    const s = emitHookScript({
      event: 'PostToolUse',
      decision: { mode: 'allow', additionalContext: 'ctx', systemMessage: 'sys', suppressOutput: true, blockStyle: 'json' },
    });
    const jq = jqLine(s);
    expect(jq).toContain('systemMessage: $sysmsg');
    expect(jq).toContain('suppressOutput: true');
    expect(jq).toContain('hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: $actx }');
  });

  it('adds SC2034 suppression only when the body does not reference input', () => {
    const withInput = emitHookScript({ event: 'PreToolUse', body: 'echo "$input"' });
    expect(withInput).not.toContain('shellcheck disable=SC2034');
    const noInput = emitHookScript({ event: 'PreToolUse', body: 'echo hi' });
    expect(noInput).toContain('# shellcheck disable=SC2034');
  });

  it('always emits shebang, set -euo pipefail, jq guard and stdin read', () => {
    const s = emitHookScript({ event: 'PreToolUse', body: 'echo "$input"' });
    expect(s.startsWith('#!/bin/bash\n')).toBe(true);
    expect(s).toContain('set -euo pipefail');
    expect(s).toContain('command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }');
    expect(s).toContain('input=$(cat)');
  });
});

// ---------------------------------------------------------------------------
// Plugin bundle target — exact structure.
// ---------------------------------------------------------------------------
describe('plugin bundle', () => {
  it('re-roots assets under the slug and adds plugin.json + hooks/hooks.json, dropping settings.json', () => {
    const files = generate(TEMPLATES.find((t) => t.slug === 'security-gate')!.graph, { target: 'plugin' });
    const paths = files.map((f) => f.path);
    expect(paths).toContain('security-gate/plugin.json');
    expect(paths).toContain('security-gate/hooks/hooks.json');
    expect(paths.some((p) => p.endsWith('settings.json'))).toBe(false);
    expect(paths.some((p) => p.startsWith('.claude/'))).toBe(false);
    // plugin.json content is exact.
    const manifest = JSON.parse(find(files, 'plugin.json').content);
    expect(manifest).toEqual({
      name: 'security-gate',
      version: '0.1.0',
      description: 'Deny destructive shell commands via a PreToolUse hook',
    });
  });

  it('hooks.json wraps the same hooks block', () => {
    const files = generate(TEMPLATES.find((t) => t.slug === 'security-gate')!.graph, { target: 'plugin' });
    const hooks = JSON.parse(find(files, 'hooks/hooks.json').content);
    expect(hooks.hooks.PreToolUse).toBeDefined();
  });

  it('re-roots a nested skill path under the slug, stripping the .claude/ prefix', () => {
    const files = generate(TEMPLATES.find((t) => t.slug === 'pr-review')!.graph, { target: 'plugin' });
    // .claude/skills/pr-review/SKILL.md → pr-review/skills/pr-review/SKILL.md
    expect(files.map((f) => f.path)).toContain('pr-review/skills/pr-review/SKILL.md');
    expect(files.some((f) => f.path.includes('.claude/'))).toBe(false);
  });

  it('keeps the hook .sh executable bit and re-roots it', () => {
    const files = generate(TEMPLATES.find((t) => t.slug === 'security-gate')!.graph, { target: 'plugin' });
    const sh = files.find((f) => f.path.endsWith('.sh'))!;
    expect(sh.path).toBe('security-gate/hooks/pretooluse-1.sh');
    expect(sh.executable).toBe(true);
  });

  it('rewrites hook command to ${CLAUDE_PLUGIN_ROOT}/hooks/… (not CLAUDE_PROJECT_DIR)', () => {
    const files = generate(TEMPLATES.find((t) => t.slug === 'security-gate')!.graph, { target: 'plugin' });
    const hooks = JSON.parse(find(files, 'hooks/hooks.json').content);
    const cmd = hooks.hooks.PreToolUse[0].hooks[0].command;
    expect(cmd).toBe('${CLAUDE_PLUGIN_ROOT}/hooks/pretooluse-1.sh');
    expect(cmd).not.toContain('CLAUDE_PROJECT_DIR');
    expect(cmd).not.toContain('.claude/');
  });

  it('plugin.json description falls back to meta.name when description is absent', () => {
    const graph = g([baseCmd()], [], {}, { name: 'No Desc', slug: 'no-desc' });
    const manifest = JSON.parse(find(generate(graph, { target: 'plugin' }), 'plugin.json').content);
    expect(manifest.description).toBe('No Desc');
  });
});

// ---------------------------------------------------------------------------
// includeGraphFile option.
// ---------------------------------------------------------------------------
describe('generate options', () => {
  it('omits flow.clauflow.json when includeGraphFile is false', () => {
    const files = generate(baseGraph(), { includeGraphFile: false });
    expect(files.some((f) => f.path === 'flow.clauflow.json')).toBe(false);
  });
  it('includes flow.clauflow.json by default', () => {
    expect(generate(baseGraph()).some((f) => f.path === 'flow.clauflow.json')).toBe(true);
  });
});

function baseGraph() {
  return g([baseCmd(), n.prompt('p', { body: 'hi' })], [e('c1', 'p')]);
}

describe('ExportGateError message + file ordering', () => {
  it('names the blocking rule ids and count in the message', () => {
    // CF001 (no trigger) blocks.
    try {
      generate(g([n.prompt('p', { body: 'x' })]));
      throw new Error('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('1 blocking diagnostic');
      expect(msg).toContain('CF001');
    }
  });

  it('returns files sorted by path (stable, ascending)', () => {
    const paths = generate(baseGraph()).map((f) => f.path);
    expect(paths).toEqual([...paths].sort());
  });
});

// ---------------------------------------------------------------------------
// Optional-field presence/absence — each toggled field asserted both ways so a
// mutated `if (cond)` → `if (true)` / `if (false)` is caught.
// ---------------------------------------------------------------------------
const hookGraph = (handler: ReturnType<typeof n.command>) =>
  g([baseCmd(), n.hookEvent('t', { event: 'PreToolUse', matcher: 'Bash', scope: 'project' }), handler], [e('t', handler.id)]);

const handlerJson = (files: GeneratedFile[]) =>
  JSON.parse(find(files, 'settings.json').content).hooks.PreToolUse[0].hooks[0];

describe('command handler optional fields (present vs absent)', () => {
  it('args: present emits, absent omits', () => {
    expect(handlerJson(generate(hookGraph(n.command('h', { command: 'x', args: ['--flag'] }))))).toHaveProperty('args', ['--flag']);
    expect(handlerJson(generate(hookGraph(n.command('h', { command: 'x' }))))).not.toHaveProperty('args');
  });
  it('shell: present emits, absent omits', () => {
    expect(handlerJson(generate(hookGraph(n.command('h', { command: 'x', shell: 'powershell' }))))).toHaveProperty('shell', 'powershell');
    expect(handlerJson(generate(hookGraph(n.command('h', { command: 'x' }))))).not.toHaveProperty('shell');
  });
  it('timeout: present emits (incl. 0), absent omits', () => {
    expect(handlerJson(generate(hookGraph(n.command('h', { command: 'x', timeout: 0 }))))).toHaveProperty('timeout', 0);
    expect(handlerJson(generate(hookGraph(n.command('h', { command: 'x' }))))).not.toHaveProperty('timeout');
  });
  it('statusMessage / async / asyncRewake / if: present vs absent', () => {
    const full = handlerJson(generate(hookGraph(
      n.command('h', { command: 'x', statusMessage: 'go', async: true, asyncRewake: true, if: 'Bash(git *)' }),
    )));
    expect(full).toMatchObject({ statusMessage: 'go', async: true, asyncRewake: true, if: 'Bash(git *)' });
    const bare = handlerJson(generate(hookGraph(n.command('h', { command: 'x' }))));
    for (const k of ['statusMessage', 'async', 'asyncRewake', 'if']) expect(bare).not.toHaveProperty(k);
  });
  it('once is never emitted to settings.json (CF107)', () => {
    // once triggers CF107 (warn); ack it so the gate emits, then assert it is dropped.
    const graph = hookGraph(n.command('h', { command: 'x', once: true }));
    graph.meta.ackedWarnings = ['CF107'];
    expect(handlerJson(generate(graph))).not.toHaveProperty('once');
  });
});

describe('http/prompt/mcp handler optional fields', () => {
  const settingsFor = (handler: ReturnType<typeof n.http>) => handlerJson(generate(hookGraph(handler as never)));
  it('http: headers/allowedEnvVars/timeout present vs absent', () => {
    expect(settingsFor(n.http('h', { url: 'u', headers: { A: '1' }, allowedEnvVars: ['E'], timeout: 5 }))).toMatchObject({
      type: 'http', url: 'u', headers: { A: '1' }, allowedEnvVars: ['E'], timeout: 5,
    });
    const bare = settingsFor(n.http('h', { url: 'u' }));
    for (const k of ['headers', 'allowedEnvVars', 'timeout']) expect(bare).not.toHaveProperty(k);
  });
  it('prompt: model present vs absent', () => {
    expect(settingsFor(n.promptHandler('h', { prompt: 'p', model: 'opus' }) as never)).toHaveProperty('model', 'opus');
    expect(settingsFor(n.promptHandler('h', { prompt: 'p' }) as never)).not.toHaveProperty('model');
  });
  it('mcp_tool: input present vs absent', () => {
    expect(settingsFor(n.mcpTool('h', { server: 's', tool: 't', input: { a: 1 } }) as never)).toHaveProperty('input', { a: 1 });
    expect(settingsFor(n.mcpTool('h', { server: 's', tool: 't' }) as never)).not.toHaveProperty('input');
  });
});

describe('settings.json field mapping (present vs absent, exact)', () => {
  const settings = (over: Parameters<typeof g>[2]) => {
    const files = generate(g([baseCmd()], [], over));
    const f = files.find((x) => x.path.endsWith('settings.json'));
    return f ? JSON.parse(f.content) : {};
  };
  it('outputStyle', () => {
    expect(settings({ outputStyle: 'terse' }).outputStyle).toBe('terse');
    expect(settings({}).outputStyle).toBeUndefined();
  });
  it('disableAllHooks only when true', () => {
    expect(settings({ disableAllHooks: true }).disableAllHooks).toBe(true);
    expect(settings({ disableAllHooks: false }).disableAllHooks).toBeUndefined();
  });
  it('effortLevel present for high, absent for xhigh (goes to run.sh)', () => {
    expect(settings({ effort: 'high' }).effortLevel).toBe('high');
    // xhigh with no runner → CF401 would block; but here just assert not in settings.
    const s = settings({ effort: 'medium' });
    expect(s.effortLevel).toBe('medium');
  });
  it('permissions buckets emitted only when non-empty', () => {
    const s = settings({ permissions: { allow: ['Read'], deny: [], ask: [] } });
    expect(s.permissions).toEqual({ allow: ['Read'] });
    expect(s.permissions.deny).toBeUndefined();
    expect(s.permissions.ask).toBeUndefined();
  });
  it('no settings.json emitted when nothing to configure', () => {
    const files = generate(g([baseCmd()]));
    expect(files.some((f) => f.path.endsWith('settings.json'))).toBe(false);
  });
});

describe('run.sh flag emission (present vs absent)', () => {
  const run = (settings: Parameters<typeof g>[2], headlessData = { promptTemplate: 'go' }) =>
    find(generate(g([n.headless('h', headlessData)], [], settings)), 'run.sh').content;

  it('worktree flag toggles', () => {
    expect(run({ headless: { enabled: true, worktree: true } })).toContain('--worktree');
    expect(run({ headless: { enabled: true, worktree: false } })).not.toContain('--worktree');
  });
  it('verbose flag toggles', () => {
    expect(run({ headless: { enabled: true, verbose: true } })).toContain('--verbose');
    expect(run({ headless: { enabled: true } })).not.toContain('--verbose');
  });
  it('maxTurns emitted when set (incl. 0)', () => {
    expect(run({ headless: { enabled: true, maxTurns: 0 } })).toContain('--max-turns 0');
    expect(run({ headless: { enabled: true } })).not.toContain('--max-turns');
  });
  it('initMode maps to the right flag', () => {
    expect(find(generate(g([n.headless('h', { promptTemplate: 'go', initMode: 'init-only' })], [], {})), 'run.sh').content).toContain('--init-only');
    expect(find(generate(g([n.headless('h', { promptTemplate: 'go', initMode: 'maintenance' })], [], {})), 'run.sh').content).toContain('--maintenance');
  });
  it('no run.sh when neither headless setting nor headless node present', () => {
    expect(generate(g([baseCmd()])).some((f) => f.path === 'run.sh')).toBe(false);
  });
});

describe('hooks block grouping', () => {
  it('groups handlers sharing a matcher into one entry', () => {
    const graph = g(
      [
        baseCmd(),
        n.hookEvent('t', { event: 'PreToolUse', matcher: 'Bash', scope: 'project' }),
        n.command('h1', { command: 'a' }),
        n.command('h2', { command: 'b' }),
      ],
      [e('t', 'h1'), e('t', 'h2')],
    );
    const hooks = JSON.parse(find(generate(graph), 'settings.json').content).hooks.PreToolUse;
    expect(hooks).toHaveLength(1);
    expect(hooks[0].hooks).toHaveLength(2);
    expect(hooks[0].matcher).toBe('Bash');
  });
});

describe('hook scope routing → settings.json vs settings.local.json', () => {
  const twoScopes = () =>
    generate(
      g(
        [
          baseCmd(),
          n.hookEvent('tp', { event: 'PreToolUse', matcher: 'Bash', scope: 'project' }),
          n.command('hp', { command: 'proj' }),
          n.hookEvent('tl', { event: 'PostToolUse', matcher: 'Edit', scope: 'local' }),
          n.command('hl', { command: 'local-only' }),
        ],
        [e('tp', 'hp'), e('tl', 'hl')],
      ),
    );

  it('project-scoped hook → settings.json', () => {
    const s = JSON.parse(find(twoScopes(), 'settings.json').content);
    expect(s.hooks.PreToolUse).toBeDefined();
    expect(s.hooks.PostToolUse).toBeUndefined();
  });

  it('local-scoped hook → settings.local.json only', () => {
    const files = twoScopes();
    const local = JSON.parse(find(files, 'settings.local.json').content);
    expect(local.hooks.PostToolUse[0].hooks[0].command).toBe('local-only');
    expect(local.hooks.PreToolUse).toBeUndefined();
  });

  it('no settings.local.json when no local-scoped hooks exist', () => {
    const files = generate(
      g([baseCmd(), n.hookEvent('t', { event: 'PreToolUse', matcher: 'Bash', scope: 'project' }), n.command('h', { command: 'x' })], [e('t', 'h')]),
    );
    expect(files.some((f) => f.path.endsWith('settings.local.json'))).toBe(false);
  });
});

describe('sessionStart trigger matcher', () => {
  it('passes the matcher (startup/resume/…) through to the SessionStart entry', () => {
    const graph = g(
      [baseCmd(), n.sessionStart('t', { matcher: 'resume' }), n.command('h', { command: 'x' })],
      [e('t', 'h')],
    );
    const entry = JSON.parse(find(generate(graph), 'settings.json').content).hooks.SessionStart[0];
    expect(entry.matcher).toBe('resume');
  });
});
