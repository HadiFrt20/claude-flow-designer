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
  it('PreToolUse deny → hookSpecificOutput with permissionDecision deny, reason inside', () => {
    const s = emitHookScript({ event: 'PreToolUse', body: 'x=1', decision: { mode: 'deny', reason: 'no', blockStyle: 'json' } });
    expect(s).toContain(
      `jq -n --arg reason 'no' '{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason } }'`,
    );
    expect(s).not.toContain('decision: "block"');
  });

  it('Stop block via exit2 → reason to stderr + exit 2, no jq', () => {
    const s = emitHookScript({ event: 'Stop', decision: { mode: 'block', reason: 'halt', blockStyle: 'exit2' } });
    expect(s).toContain(`echo 'halt' >&2`);
    expect(s.trimEnd().endsWith('exit 2')).toBe(true);
    expect(s).not.toContain('jq -n');
  });

  it('Stop block via json → decision:block JSON', () => {
    const s = emitHookScript({ event: 'Stop', decision: { mode: 'block', reason: 'halt', blockStyle: 'json' } });
    expect(s).toContain(`jq -n --arg reason 'halt' '{ decision: "block", reason: $reason }'`);
  });

  it('stopAll → continue:false with stopReason', () => {
    const s = emitHookScript({ event: 'Stop', decision: { mode: 'stopAll', reason: 'done', blockStyle: 'json' } });
    expect(s).toContain(`jq -n --arg reason 'done' '{ continue: false, stopReason: $reason }'`);
  });

  it('merges additionalContext/systemMessage/suppressOutput', () => {
    const s = emitHookScript({
      event: 'PostToolUse',
      decision: { mode: 'allow', additionalContext: 'ctx', systemMessage: 'sys', suppressOutput: true, blockStyle: 'json' },
    });
    expect(s).toContain('additionalContext: $actx');
    expect(s).toContain('systemMessage: $sysmsg');
    expect(s).toContain('suppressOutput: true');
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
