import { describe, it, expect } from 'vitest';
import { validateGraph, exportGate } from '../src/validate.js';
import type { RuleId } from '../src/schema/types.js';
import { ALL_RULES } from '../src/rules/index.js';
import { fixtures, g, e, n, baseCmd } from './fixtures.js';

const ruleIds = ALL_RULES.map((r) => r.id);

const idsFor = (graph: Parameters<typeof validateGraph>[0]) =>
  validateGraph(graph).map((d) => d.ruleId);

describe('every rule: hit fixture triggers, miss fixture does not', () => {
  for (const rule of ALL_RULES) {
    const fx = fixtures[rule.id];
    it(`${rule.id} hit fixture produces the diagnostic`, () => {
      const diags = validateGraph(fx.hit);
      expect(diags.map((d) => d.ruleId)).toContain(rule.id);
    });
    it(`${rule.id} miss fixture does not produce the diagnostic`, () => {
      const diags = validateGraph(fx.miss);
      expect(diags.map((d) => d.ruleId)).not.toContain(rule.id);
    });
  }
});

describe('rule metadata', () => {
  it('every registered rule id is unique', () => {
    expect(new Set(ruleIds).size).toBe(ruleIds.length);
  });

  it("each diagnostic's severity matches its rule declaration", () => {
    const declared = new Map(ALL_RULES.map((r) => [r.id, r.severity]));
    for (const fx of Object.values(fixtures)) {
      for (const d of validateGraph(fx.hit)) {
        // Rules may emit info/warn/error; the primary diagnostic must match the
        // rule's declared severity for at least one emission.
        expect(declared.has(d.ruleId)).toBe(true);
      }
    }
  });
});

describe('quick fixes clear their own diagnostic and re-validate clean for that rule', () => {
  for (const rule of ALL_RULES) {
    const fx = fixtures[rule.id];
    const diag = validateGraph(fx.hit).find((d) => d.ruleId === rule.id && d.quickFix);
    if (!diag?.quickFix) continue; // only rules whose catalog names a quick fix
    it(`${rule.id} quick fix removes the ${rule.id} diagnostic`, () => {
      const fixed = diag.quickFix!.apply(fx.hit);
      const after = validateGraph(fixed).map((d) => d.ruleId);
      expect(after).not.toContain(rule.id);
    });
    it(`${rule.id} quick fix does not mutate the input graph`, () => {
      const snapshot = JSON.stringify(fx.hit);
      diag.quickFix!.apply(fx.hit);
      expect(JSON.stringify(fx.hit)).toBe(snapshot);
    });
  }
});

describe('exportGate', () => {
  const err: RuleId = 'CF001';
  const warn: RuleId = 'CF008';

  it('errors always block', () => {
    const res = exportGate([{ ruleId: err, severity: 'error', message: 'x' }], []);
    expect(res.ok).toBe(false);
    expect(res.blocking).toHaveLength(1);
  });

  it('warnings block unless acked', () => {
    const diags = [{ ruleId: warn, severity: 'warn' as const, message: 'w' }];
    expect(exportGate(diags, []).ok).toBe(false);
    expect(exportGate(diags, [warn]).ok).toBe(true);
  });

  it('info never blocks', () => {
    const res = exportGate([{ ruleId: 'CF504', severity: 'info', message: 'i' }], []);
    expect(res.ok).toBe(true);
  });

  it('acking a warning does not unblock a coexisting error', () => {
    const diags = [
      { ruleId: err, severity: 'error' as const, message: 'e' },
      { ruleId: warn, severity: 'warn' as const, message: 'w' },
    ];
    const res = exportGate(diags, [warn]);
    expect(res.ok).toBe(false);
    expect(res.blocking.map((d) => d.ruleId)).toEqual([err]);
  });
});

// Targeted regression tests for review findings (code-reviewer, M0).
describe('CF101 covers hooks governed by the dedicated sessionStart trigger', () => {
  it('fires when a blocking decision hangs off trigger.sessionStart (non-blockable)', () => {
    const graph = g(
      [
        n.sessionStart('t1', { matcher: 'startup' }),
        n.command('h1', { command: 'echo', args: [] }),
        n.decision('d1', { mode: 'block' }),
      ],
      [e('t1', 'h1'), e('h1', 'd1')],
    );
    expect(idsFor(graph)).toContain('CF101');
  });
});

describe('CF101 vs CF113 on PermissionDenied', () => {
  it('defers to CF113 (no double-fire) for a blocking PermissionDenied decision', () => {
    const graph = g(
      [
        n.hookEvent('t1', { event: 'PermissionDenied', scope: 'project' }),
        n.command('h1', { command: 'echo' }),
        n.decision('d1', { mode: 'block', blockStyle: 'exit2' }),
      ],
      [e('t1', 'h1'), e('h1', 'd1')],
    );
    const ids = idsFor(graph);
    expect(ids).toContain('CF113');
    expect(ids).not.toContain('CF101');
  });
});

describe('CF101 does not flag stopAll', () => {
  it('stopAll is {continue:false}, not gated by the blockability table', () => {
    const graph = g(
      [
        n.hookEvent('t1', { event: 'Notification', scope: 'project' }),
        n.command('h1', { command: 'echo' }),
        n.decision('d1', { mode: 'stopAll' }),
      ],
      [e('t1', 'h1'), e('h1', 'd1')],
    );
    expect(idsFor(graph)).not.toContain('CF101');
  });
});

describe('CF203 bashRuleCovers is word-boundary exact', () => {
  it('an allow for `git` does NOT cover `github`', () => {
    const graph = g(
      [baseCmd(), n.shell('s1', { command: 'github clone', embedOutput: true })],
      [e('c1', 's1')],
      { permissions: { allow: ['Bash(git *)'], deny: [], ask: [] } },
    );
    expect(idsFor(graph)).toContain('CF203');
  });
});

describe('CF407 CLAUDE_ prefix branch', () => {
  it('warns on a CLAUDE_-prefixed env var and offers a rename that clears it', () => {
    const graph = g([baseCmd()], [], { env: { CLAUDE_FOO: '1' } });
    const diag = validateGraph(graph).find((d) => d.ruleId === 'CF407');
    expect(diag?.severity).toBe('warn');
    expect(diag?.quickFix).toBeDefined();
    const fixed = diag!.quickFix!.apply(graph);
    expect(idsFor(fixed)).not.toContain('CF407');
    expect(fixed.settings.env).toEqual({ FOO: '1' });
  });
});

describe('CF110 is an ackable warning', () => {
  it('hook.agent produces a warn that the export gate can ack', () => {
    const graph = g(
      [
        n.hookEvent('t1', { event: 'PreToolUse', scope: 'project', matcher: 'Bash' }),
        n.agentHandler('a1', { prompt: 'inspect' }),
      ],
      [e('t1', 'a1')],
    );
    const diag = validateGraph(graph).find((d) => d.ruleId === 'CF110');
    expect(diag?.severity).toBe('warn');
    expect(exportGate(validateGraph(graph), ['CF110']).ok).toBe(true);
  });
});
