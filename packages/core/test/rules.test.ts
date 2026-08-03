import { describe, it, expect } from 'vitest';
import { validateGraph, exportGate } from '../src/validate.js';
import { generate } from '../src/codegen/index.js';
import type { RuleId } from '../src/schema/types.js';
import { ALL_RULES } from '../src/rules/index.js';
import { fixtures, g, e, n } from './fixtures.js';

const ruleIds = ALL_RULES.map((r) => r.id);

const idsFor = (graph: Parameters<typeof validateGraph>[0]) =>
  validateGraph(graph).map((d) => d.ruleId);

describe('every rule: hit fixture triggers, miss fixture does not', () => {
  for (const rule of ALL_RULES) {
    const fx = fixtures[rule.id];
    it(`${rule.id} hit fixture produces the diagnostic`, () => {
      expect(idsFor(fx.hit)).toContain(rule.id);
    });
    it(`${rule.id} miss fixture does not produce the diagnostic`, () => {
      expect(idsFor(fx.miss)).not.toContain(rule.id);
    });
  }
});

describe('rule metadata', () => {
  it('every registered rule id is unique', () => {
    expect(new Set(ruleIds).size).toBe(ruleIds.length);
  });

  it('every emitted diagnostic maps to a declared rule', () => {
    const declared = new Map(ALL_RULES.map((r) => [r.id, r.severity]));
    for (const fx of Object.values(fixtures)) {
      for (const d of validateGraph(fx.hit)) {
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
      expect(idsFor(fixed)).not.toContain(rule.id);
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
    const res = exportGate([{ ruleId: 'CF615', severity: 'info', message: 'i' }], []);
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

// Targeted regression tests for workflow-script semantics (code-reviewer, M6).
describe('CF605 template-ref semantics', () => {
  it('fires for a ref that is not upstream (downstream/self reference)', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('a', { prompt: 'Read {{b}} first.' }),
       n.agent('b', { prompt: 'later' }),
       n.ret('ret', { source: 'b', transform: 'none' })],
      [e('meta', 'a'), e('a', 'b'), e('b', 'ret')],
    );
    expect(idsFor(graph)).toContain('CF605');
  });

  it('fires for a ref to a node that produces no binding (the return node)', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('a', { prompt: 'Use {{ret}} somehow.' }),
       n.ret('ret', { source: 'a', transform: 'none' })],
      [e('meta', 'a'), e('a', 'ret')],
    );
    expect(idsFor(graph)).toContain('CF605');
  });

  it('does NOT fire for {{args}} or a valid upstream ref', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('a', { prompt: 'Produce output.' }),
       n.agent('b', { prompt: 'Combine {{args}} with {{a}}.' }),
       n.ret('ret', { source: 'b', transform: 'none' })],
      [e('meta', 'a'), e('a', 'b'), e('b', 'ret')],
    );
    expect(idsFor(graph)).not.toContain('CF605');
  });

  it('fires on an invalid field path (code-injection guard, B1)', () => {
    // The field part of a {{id.field}} ref is interpolated raw into JS, so a
    // non-dotted-identifier path is a code-injection vector and must be flagged.
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('a', { prompt: 'Produce.' }),
       n.agent('b', { prompt: 'Use {{a.x || console.log(1)}} here.' }),
       n.ret('ret', { source: 'b', transform: 'none' })],
      [e('meta', 'a'), e('a', 'b'), e('b', 'ret')],
    );
    expect(idsFor(graph)).toContain('CF605');
  });

  it('accepts a valid dotted field path', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('a', { prompt: 'Produce.', schema: { type: 'object', properties: { out: { type: 'object' } } } }),
       n.agent('b', { prompt: 'Use {{a.out.value}} here.' }),
       n.ret('ret', { source: 'b', transform: 'none' })],
      [e('meta', 'a'), e('a', 'b'), e('b', 'ret')],
    );
    expect(idsFor(graph)).not.toContain('CF605');
  });
});

describe('CF607 array-field check', () => {
  it('does NOT fire when sourceField points at a declared array', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('a', { prompt: 'List files.', schema: { type: 'object', properties: { files: { type: 'array' } } } }),
       n.pipeline('pipe', { source: 'a', sourceField: 'files', itemPrompt: 'Audit {{item}}.', itemLabel: '{{item}}' }),
       n.ret('ret', { source: 'pipe', transform: 'none' })],
      [e('meta', 'a'), e('a', 'pipe'), e('pipe', 'ret')],
    );
    expect(idsFor(graph)).not.toContain('CF607');
  });

  it('fires when sourceField points at a non-array schema field', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('a', { prompt: 'Count.', schema: { type: 'object', properties: { count: { type: 'number' } } } }),
       n.pipeline('pipe', { source: 'a', sourceField: 'count', itemPrompt: 'Do {{item}}.', itemLabel: '{{item}}' }),
       n.ret('ret', { source: 'pipe', transform: 'none' })],
      [e('meta', 'a'), e('a', 'pipe'), e('pipe', 'ret')],
    );
    expect(idsFor(graph)).toContain('CF607');
  });

  it('does NOT fire when the pipeline fans out directly over args', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.pipeline('pipe', { source: 'args', itemPrompt: 'Grade {{item}}.', itemLabel: '{{item}}' }),
       n.ret('ret', { source: 'pipe', transform: 'none' })],
      [e('meta', 'pipe'), e('pipe', 'ret')],
    );
    expect(idsFor(graph)).not.toContain('CF607');
  });
});

describe('validation extends to the parallel kind (M8)', () => {
  it('CF607 fires on a parallel over a non-array schema field', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('a', { prompt: 'Count.', schema: { type: 'object', properties: { count: { type: 'number' } } } }),
       n.parallel('par', { source: 'a', sourceField: 'count', itemVar: 'd', itemPrompt: 'Do {{d}}.', itemLabel: '{{d}}' }),
       n.ret('ret', { source: 'par', transform: 'none' })],
      [e('meta', 'a'), e('a', 'par'), e('par', 'ret')],
    );
    expect(idsFor(graph)).toContain('CF607');
  });

  it('CF614 fires (with itemVar-aware quick fix) on a parallel with no itemLabel', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.parallel('par', { source: 'args', itemVar: 'c', itemPrompt: 'Grade {{c}}.' }),
       n.ret('ret', { source: 'par', transform: 'none' })],
      [e('meta', 'par'), e('par', 'ret')],
    );
    const diag = validateGraph(graph).find((d) => d.ruleId === 'CF614' && d.nodeId === 'par');
    expect(diag).toBeDefined();
    expect(diag!.quickFix!.title).toBe('Add {{c}} label'); // uses the node's itemVar
    expect(idsFor(diag!.quickFix!.apply(graph))).not.toContain('CF614');
  });

  it('CF605 treats the parallel itemVar as the allowed local and flags a wrong var', () => {
    const bad = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.parallel('par', { source: 'args', itemVar: 'c', itemPrompt: 'Grade {{item}}.', itemLabel: '{{c}}' }), // {{item}} ≠ itemVar 'c'
       n.ret('ret', { source: 'par', transform: 'none' })],
      [e('meta', 'par'), e('par', 'ret')],
    );
    expect(idsFor(bad)).toContain('CF605');
    const ok = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.parallel('par', { source: 'args', itemVar: 'c', itemPrompt: 'Grade {{c}}.', itemLabel: '{{c}}' }),
       n.ret('ret', { source: 'par', transform: 'none' })],
      [e('meta', 'par'), e('par', 'ret')],
    );
    expect(idsFor(ok)).not.toContain('CF605');
  });

  it('CF613 flags an unknown model on a parallel stage', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.parallel('par', { source: 'args', itemVar: 'c', itemPrompt: 'Grade {{c}}.', itemLabel: '{{c}}', model: 'gpt-4' }),
       n.ret('ret', { source: 'par', transform: 'none' })],
      [e('meta', 'par'), e('par', 'ret')],
    );
    expect(idsFor(graph)).toContain('CF613');
  });
});

describe('CF608 branch port cardinality', () => {
  it('does NOT fire for a branch with exactly one then and one else', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('review', { prompt: 'Review.', schema: { type: 'object', properties: { safe: { type: 'boolean' } } } }),
       n.branch('br', { source: 'review', field: 'safe' }),
       n.agent('approve', { prompt: 'Approve.' }),
       n.agent('request', { prompt: 'Request changes.' }),
       n.ret('ret', { source: 'review', transform: 'none' })],
      [e('meta', 'review'), e('review', 'br'),
       e('br', 'approve', 'then'), e('br', 'request', 'else'), e('br', 'ret')],
    );
    expect(idsFor(graph)).not.toContain('CF608');
  });
});

describe('CF609 arm-exclusive binding refs (B2)', () => {
  it('fires when output.return.source targets a branch-arm-exclusive binding', () => {
    // return.source = 'approve' (then-arm-exclusive) would compile to a ref to an
    // out-of-scope const — a structured ref CF609 must catch, not just prompt text.
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('review', { prompt: 'Review.', schema: { type: 'object', properties: { safe: { type: 'boolean' } } } }),
       n.branch('br', { source: 'review', field: 'safe' }),
       n.agent('approve', { prompt: 'Approve.' }),
       n.agent('request', { prompt: 'Request.' }),
       n.ret('ret', { source: 'approve', transform: 'none' })],
      [e('meta', 'review'), e('review', 'br'),
       e('br', 'approve', 'then'), e('br', 'request', 'else'), e('br', 'ret')],
    );
    expect(idsFor(graph)).toContain('CF609');
  });

  it('does NOT fire when the return targets a pre-branch (in-scope) binding', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('review', { prompt: 'Review.', schema: { type: 'object', properties: { safe: { type: 'boolean' } } } }),
       n.branch('br', { source: 'review', field: 'safe' }),
       n.agent('approve', { prompt: 'Approve.' }),
       n.agent('request', { prompt: 'Request.' }),
       n.ret('ret', { source: 'review', transform: 'none' })],
      [e('meta', 'review'), e('review', 'br'),
       e('br', 'approve', 'then'), e('br', 'request', 'else'), e('br', 'ret')],
    );
    expect(idsFor(graph)).not.toContain('CF609');
  });
});

describe('CF008 rename quick fix', () => {
  it('renames a bundled-command shadow and clears the warning', () => {
    const graph = fixtures.CF008.hit;
    const diag = validateGraph(graph).find((d) => d.ruleId === 'CF008');
    expect(diag?.quickFix).toBeDefined();
    const fixed = diag!.quickFix!.apply(graph);
    expect(idsFor(fixed)).not.toContain('CF008');
  });
});

describe('CF606 return counting with raw blocks (B2)', () => {
  it('accepts a raw block whose code ends in a return as the sole sink', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.raw('raw', { code: 'const r = 1\nreturn { r }', produces: ['r'] }, 'code')],
      [e('meta', 'raw')],
    );
    expect(idsFor(graph)).not.toContain('CF606');
  });

  it('fires when a raw return coexists with an output.return (two returns)', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.raw('raw', { code: 'return 1', produces: [] }, 'code'),
       n.agent('a', { prompt: 'x' }),
       n.ret('ret', { source: 'a', transform: 'none' })],
      [e('meta', 'raw'), e('raw', 'a'), e('a', 'ret')],
    );
    expect(idsFor(graph)).toContain('CF606');
  });

  it('fires when the returning raw block is not the final node', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.raw('raw', { code: 'return 1', produces: [] }, 'code'),
       n.agent('a', { prompt: 'x' })],
      [e('meta', 'raw'), e('raw', 'a')],
    );
    expect(idsFor(graph)).toContain('CF606');
  });

  it('fires when a raw block has more than one top-level return', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.raw('raw', { code: 'return 1\nreturn 2', produces: [] }, 'code')],
      [e('meta', 'raw')],
    );
    expect(idsFor(graph)).toContain('CF606');
  });
});

describe('CF610 is an ackable warning', () => {
  it('produces a warn that the export gate can ack', () => {
    const graph = fixtures.CF610.hit;
    const diag = validateGraph(graph).find((d) => d.ruleId === 'CF610');
    expect(diag?.severity).toBe('warn');
    expect(exportGate(validateGraph(graph), ['CF610']).ok).toBe(true);
  });
});

describe('CF613 covers the graph-level default model', () => {
  it('warns on an unknown settings.model (it propagates to every stage)', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }), n.agent('a', { prompt: 'x' }),
       n.ret('ret', { source: 'a', transform: 'none' })],
      [e('meta', 'a'), e('a', 'ret')],
      { model: 'gpt-4' },
    );
    const diag = validateGraph(graph).find((d) => d.ruleId === 'CF613' && d.field === 'model' && !d.nodeId);
    expect(diag).toBeDefined();
    expect(diag?.message).toMatch(/default model/);
  });

  it('does NOT warn on a known settings.model', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }), n.agent('a', { prompt: 'x' }),
       n.ret('ret', { source: 'a', transform: 'none' })],
      [e('meta', 'a'), e('a', 'ret')],
      { model: 'opus' },
    );
    expect(idsFor(graph)).not.toContain('CF613');
  });
});

// M10 fanout: branch-prompt refs + destructured-binding node-id ref (review B2/M2).
describe('fanout rules (M10)', () => {
  it('CF605 flags an unknown template ref inside a fanout branch prompt', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.fanout('fo', { mode: 'parallel', branches: [{ kind: 'thunk', prompt: 'use {{nope}} here' }] }),
       n.ret('ret', { source: 'fo', transform: 'none' })],
      [e('meta', 'fo'), e('fo', 'ret')],
    );
    expect(idsFor(graph)).toContain('CF605');
  });

  it('CF605 allows a map branch itemVar ref in that branch prompt', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('list', { prompt: 'list', schema: { type: 'object', properties: { xs: { type: 'array' } } } }),
       n.fanout('fo', { mode: 'parallel', branches: [{ kind: 'map', source: 'list', sourceField: 'xs', itemVar: 'x', itemPrompt: 'do {{x}}' }] }),
       n.ret('ret', { source: 'fo', transform: 'none' })],
      [e('meta', 'list'), e('list', 'fo'), e('fo', 'ret')],
    );
    expect(idsFor(graph)).not.toContain('CF605');
  });

  it('CF605 flags a node-id ref to a DESTRUCTURED fanout (it produces no single binding)', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.fanout('fo', { mode: 'parallel', bindingPattern: '[a, b]', bindingPatternNames: ['a', 'b'], branches: [{ kind: 'thunk', prompt: 'one' }, { kind: 'thunk', prompt: 'two' }] }),
       n.agent('use', { prompt: 'read {{fo}}' }), // {{fo}} = the fanout node id, which has no single binding
       n.ret('ret', { source: 'use', transform: 'none' })],
      [e('meta', 'fo'), e('fo', 'use'), e('use', 'ret')],
    );
    expect(idsFor(graph)).toContain('CF605');
  });

  it('CF605 flags a STRUCTURED source ref (output.return.source) to a destructured fanout', () => {
    // The sibling channel to the {{ref}} case: a resultRef pointing at a node that
    // produces no single binding must be a gate diagnostic, not a self-lint crash.
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.fanout('fo', { mode: 'parallel', bindingPattern: '[a, b]', bindingPatternNames: ['a', 'b'], branches: [{ kind: 'thunk', prompt: 'one' }, { kind: 'thunk', prompt: 'two' }] }),
       n.ret('ret', { source: 'fo', transform: 'none' })], // return the fanout node id → no single binding
      [e('meta', 'fo'), e('fo', 'ret')],
    );
    expect(idsFor(graph)).toContain('CF605');
    expect(() => generate(graph)).toThrow(); // gate blocks before emit (no silent bad output)
  });

  it('a destructured fanout referenced by its bare pattern name resolves cleanly + generates', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.fanout('fo', { mode: 'parallel', bindingPattern: '[a, b]', bindingPatternNames: ['a', 'b'], branches: [{ kind: 'thunk', prompt: 'one' }, { kind: 'thunk', prompt: 'two' }] }),
       n.agent('use', { prompt: 'read {{a}} and {{b}}' }),
       n.ret('ret', { source: 'use', transform: 'none' })],
      [e('meta', 'fo'), e('fo', 'use'), e('use', 'ret')],
    );
    expect(idsFor(graph)).not.toContain('CF605');
    expect(validateGraph(graph).filter((d) => d.severity === 'error')).toEqual([]);
  });
});
