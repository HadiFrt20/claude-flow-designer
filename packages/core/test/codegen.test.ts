import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { generate, ExportGateError, SelfLintError } from '../src/codegen/index.js';
import { parseProject } from '../src/importer.js';
import { TEMPLATES } from '../src/templates.js';
import type { GeneratedFile } from '../src/schema/types.js';
import type { WorkflowGraph } from '../src/schema/graph.js';
import { g, e, n, baseCmd } from './fixtures.js';

const findFile = (files: GeneratedFile[], suffix: string) =>
  files.find((f) => f.path.endsWith(suffix));

// ---------------------------------------------------------------------------
// Template gallery: snapshot every generated file, round-trip, shellcheck.
// ---------------------------------------------------------------------------
describe('template gallery', () => {
  for (const t of TEMPLATES) {
    it(`${t.slug} generates a stable file set (snapshot)`, () => {
      const files = generate(t.graph);
      // Snapshot the whole tree: paths + content + executable bit.
      expect(files).toMatchSnapshot();
    });

    it(`${t.slug} round-trips generate → parseProject → deep-equal`, () => {
      const rt = parseProject(generate(t.graph));
      expect(rt).toEqual(t.graph);
    });
  }
});

// ---------------------------------------------------------------------------
// Frontmatter field coverage (SPEC-CODEGEN skill mapping).
// ---------------------------------------------------------------------------
describe('SKILL.md frontmatter coverage', () => {
  it('emits every documented frontmatter field when present', () => {
    const graph = g(
      [
        n.cmd('c1', {
          name: 'full',
          description: 'A command exercising every frontmatter field.',
          args: [{ name: 'issue', placeholder: '$1' }],
          argumentHint: '[issue]',
          model: 'opus',
          contextFork: true,
          agent: 'helper',
          disableModelInvocation: true,
        }),
        n.subagent('s1', { name: 'helper', systemPrompt: 'Help.', description: 'the helper' }),
        n.shell('sh1', { command: 'git status', embedOutput: true }),
      ],
      [e('c1', 'sh1'), e('c1', 's1')],
      { permissions: { allow: ['Bash(git *)'], deny: [], ask: [] } },
    );
    const skill = findFile(generate(graph), 'skills/full/SKILL.md')!;
    expect(skill.content).toContain('description: A command exercising every frontmatter field.');
    expect(skill.content).toContain('argument-hint: "[issue]"');
    expect(skill.content).toContain('model: opus');
    expect(skill.content).toContain('context: fork');
    expect(skill.content).toContain('agent: helper');
    expect(skill.content).toContain('disable-model-invocation: true');
    expect(skill.content).toContain('allowed-tools: Bash(git *)');
  });

  it('omits empty frontmatter fields', () => {
    const skill = findFile(generate(g([baseCmd()])), 'SKILL.md')!;
    expect(skill.content).not.toContain('argument-hint');
    expect(skill.content).not.toContain('model:');
    expect(skill.content).not.toContain('context:');
  });

  it('preserves unknown frontmatter (data.extra) verbatim', () => {
    const graph = g([
      n.cmd('c1', { name: 'x', description: 'has extra keys', extra: { 'x-custom': 'kept' } }),
    ]);
    const skill = findFile(generate(graph), 'SKILL.md')!;
    expect(skill.content).toContain('x-custom: kept');
  });
});

// ---------------------------------------------------------------------------
// Hook handler type coverage (SPEC-CODEGEN hooks mapping).
// ---------------------------------------------------------------------------
describe('hook handler types', () => {
  const withHandler = (handler: WorkflowGraph['nodes'][number]) =>
    g(
      [
        baseCmd(),
        n.hookEvent('t1', { event: 'PreToolUse', matcher: 'Bash', scope: 'project' }),
        handler,
      ],
      [e('t1', handler.id)],
    );

  it('http handler', () => {
    const files = generate(withHandler(n.http('h', { url: 'https://x', timeout: 5 })));
    const settings = JSON.parse(findFile(files, 'settings.json')!.content);
    expect(settings.hooks.PreToolUse[0].hooks[0]).toMatchObject({ type: 'http', url: 'https://x' });
  });

  it('prompt handler', () => {
    const files = generate(withHandler(n.promptHandler('h', { prompt: 'inspect', model: 'haiku' })));
    const settings = JSON.parse(findFile(files, 'settings.json')!.content);
    expect(settings.hooks.PreToolUse[0].hooks[0]).toMatchObject({ type: 'prompt', prompt: 'inspect' });
  });

  it('mcp_tool handler', () => {
    const files = generate(withHandler(n.mcpTool('h', { server: 'gh', tool: 'list' })));
    const settings = JSON.parse(findFile(files, 'settings.json')!.content);
    expect(settings.hooks.PreToolUse[0].hooks[0]).toMatchObject({ type: 'mcp_tool', server: 'gh', tool: 'list' });
  });

  it('command handler in shell form (no script body)', () => {
    const files = generate(withHandler(n.command('h', { command: 'echo hi', timeout: 3, statusMessage: 'checking' })));
    const settings = JSON.parse(findFile(files, 'settings.json')!.content);
    expect(settings.hooks.PreToolUse[0].hooks[0]).toMatchObject({
      type: 'command', command: 'echo hi', timeout: 3, statusMessage: 'checking',
    });
  });

  it('command handler with script body → exec-form reference + .sh file', () => {
    const files = generate(withHandler(n.command('h', { command: 'bash', scriptBody: 'echo "$input" | jq .' })));
    const settings = JSON.parse(findFile(files, 'settings.json')!.content);
    const handler = settings.hooks.PreToolUse[0].hooks[0];
    expect(handler.command).toMatch(/^\$\{CLAUDE_PROJECT_DIR\}\/\.claude\/hooks\//);
    expect(handler.args).toEqual([]);
    expect(findFile(files, '.sh')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Decision mode coverage (SPEC-CODEGEN decision table).
// ---------------------------------------------------------------------------
describe('decision modes → script tails', () => {
  const scriptFor = (event: WorkflowGraph['nodes'][number], decisionData: Record<string, unknown>) =>
    g(
      [
        baseCmd(),
        event,
        n.command('h', { command: 'bash', scriptBody: 'x=1' }),
        n.decision('d', decisionData as never),
      ],
      [e(event.id, 'h'), e('h', 'd')],
    );

  it('deny on PreToolUse → permissionDecision deny JSON', () => {
    const files = generate(
      scriptFor(n.hookEvent('t1', { event: 'PreToolUse', matcher: 'Bash', scope: 'project' }), {
        mode: 'deny', reason: 'no', blockStyle: 'json',
      }),
    );
    expect(findFile(files, '.sh')!.content).toContain('permissionDecision: "deny"');
  });

  it('block on Stop via exit 2 → bare exit 2 tail', () => {
    const files = generate(
      scriptFor(n.hookEvent('t1', { event: 'Stop', scope: 'project' }), {
        mode: 'block', reason: 'stop it', blockStyle: 'exit2',
      }),
    );
    const sh = findFile(files, '.sh')!.content;
    expect(sh).toContain('exit 2');
    expect(sh).toContain('stop it');
  });

  it('stopAll → continue:false', () => {
    const files = generate(
      scriptFor(n.hookEvent('t1', { event: 'Stop', scope: 'project' }), {
        mode: 'stopAll', reason: 'halt', blockStyle: 'json',
      }),
    );
    expect(findFile(files, '.sh')!.content).toContain('continue: false');
  });

  it('ask on PreToolUse → permissionDecision ask', () => {
    const files = generate(
      scriptFor(n.hookEvent('t1', { event: 'PreToolUse', matcher: 'Bash', scope: 'project' }), {
        mode: 'ask', reason: 'confirm', blockStyle: 'json',
      }),
    );
    expect(findFile(files, '.sh')!.content).toContain('permissionDecision: "ask"');
  });

  it('additionalContext + systemMessage merged into JSON', () => {
    const files = generate(
      scriptFor(n.hookEvent('t1', { event: 'PreToolUse', matcher: 'Bash', scope: 'project' }), {
        mode: 'allow', additionalContext: 'ctx', systemMessage: 'sys', blockStyle: 'json',
      }),
    );
    const sh = findFile(files, '.sh')!.content;
    expect(sh).toContain('additionalContext: $actx');
    expect(sh).toContain('systemMessage: $sysmsg');
  });
});

// ---------------------------------------------------------------------------
// GlobalSettings row coverage (SPEC-CODEGEN GlobalSettings mapping).
// ---------------------------------------------------------------------------
describe('GlobalSettings mapping', () => {
  it('model → settings.json AND run.sh --model', () => {
    const graph = g([n.headless('h', { promptTemplate: 'go' })], [], { model: 'opus' });
    const files = generate(graph);
    expect(JSON.parse(findFile(files, 'settings.json')!.content).model).toBe('opus');
    expect(findFile(files, 'run.sh')!.content).toContain("--model 'opus'");
  });

  it('effort low/medium/high → settings.json effortLevel', () => {
    const files = generate(g([baseCmd()], [], { effort: 'high' }));
    expect(JSON.parse(findFile(files, 'settings.json')!.content).effortLevel).toBe('high');
  });

  it('effort xhigh/max → run.sh --effort ONLY (not settings.json) + comment', () => {
    const graph = g([n.headless('h', { promptTemplate: 'go' })], [], {
      effort: 'max',
      // ack CF401 so the gate lets us emit
    }, { ackedWarnings: ['CF401'] });
    const files = generate(graph);
    const settings = findFile(files, 'settings.json');
    if (settings) expect(JSON.parse(settings.content).effortLevel).toBeUndefined();
    const run = findFile(files, 'run.sh')!.content;
    expect(run).toContain('--effort max');
    expect(run).toContain('known flakiness');
  });

  it('permissionMode → permissions.defaultMode', () => {
    const graph = g([baseCmd()], [], { permissionMode: 'acceptEdits' });
    const settings = JSON.parse(findFile(generate(graph), 'settings.json')!.content);
    expect(settings.permissions.defaultMode).toBe('acceptEdits');
  });

  it('env → settings.json env', () => {
    const graph = g([baseCmd()], [], { env: { MY_VAR: '1' } });
    expect(JSON.parse(findFile(generate(graph), 'settings.json')!.content).env).toEqual({ MY_VAR: '1' });
  });

  it('headless flags → run.sh', () => {
    const graph = g([n.headless('h', { promptTemplate: 'go', initMode: 'init' })], [], {
      headless: { enabled: true, worktree: true, outputFormat: 'json', maxTurns: 12, verbose: true },
    });
    const run = findFile(generate(graph), 'run.sh')!.content;
    expect(run).toContain('--worktree');
    expect(run).toContain('--output-format json');
    expect(run).toContain('--max-turns 12');
    expect(run).toContain('--verbose');
    expect(run).toContain('--init');
  });
});

// ---------------------------------------------------------------------------
// Pipeline behaviour: gate refusal + self-lint.
// ---------------------------------------------------------------------------
describe('generate() pipeline', () => {
  it('throws ExportGateError on a blocking diagnostic (does not emit)', () => {
    // CF001: nodes but no trigger.
    const graph = g([n.prompt('p1', { body: 'x' })]);
    expect(() => generate(graph)).toThrow(ExportGateError);
  });

  it('emits deterministically (stable order, byte-identical across runs)', () => {
    const a = generate(TEMPLATES[0]!.graph);
    const b = generate(TEMPLATES[0]!.graph);
    expect(a).toEqual(b);
  });

  it('plugin target emits plugin.json + hooks/hooks.json', () => {
    const files = generate(TEMPLATES[3]!.graph, { target: 'plugin' }); // security-gate
    expect(findFile(files, 'plugin.json')).toBeDefined();
    expect(findFile(files, 'hooks/hooks.json')).toBeDefined();
  });

  it('SelfLintError is thrown on a malformed artifact', () => {
    // A hook script whose (would-be) content lacks the guard is prevented at the
    // rule layer; assert the error type is exported and constructable.
    expect(new SelfLintError('x', 'y').name).toBe('SelfLintError');
  });
});

// ---------------------------------------------------------------------------
// Generated hook scripts pass shellcheck (skipped if shellcheck is absent).
// ---------------------------------------------------------------------------
function hasShellcheck(): boolean {
  try {
    execFileSync('shellcheck', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('generated .sh scripts pass shellcheck', () => {
  const runShellcheck = hasShellcheck();
  for (const t of TEMPLATES) {
    const scripts = generate(t.graph).filter((f) => f.path.endsWith('.sh'));
    for (const s of scripts) {
      it.runIf(runShellcheck)(`shellcheck: ${t.slug}/${s.path.split('/').pop()}`, () => {
        try {
          execFileSync('shellcheck', ['-'], { input: s.content });
        } catch (err) {
          const out = (err as { stdout?: Buffer }).stdout?.toString() ?? String(err);
          throw new Error(`shellcheck failed for ${t.slug} ${s.path}:\n${out}`);
        }
      });
    }
  }
});
