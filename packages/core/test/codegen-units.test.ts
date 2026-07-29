import { describe, it, expect } from 'vitest';
import { stableJson } from '../src/codegen/json.js';
import { bindingNames, linearize, producesBinding } from '../src/codegen/model.js';
import { branchCondition } from '../src/codegen/workflow.js';
import { topoOrder } from '../src/schema/graph-utils.js';
import { emitWorkflow } from '../src/codegen/workflow.js';
import { g, e, n } from './fixtures.js';

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
// topoOrder — deterministic Kahn's order.
// ---------------------------------------------------------------------------
describe('topoOrder', () => {
  it('orders meta before its successors and returns every node', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }), n.agent('a', { prompt: 'x' }),
       n.agent('b', { prompt: 'y' }), n.ret('ret', { source: 'b', transform: 'none' })],
      [e('meta', 'a'), e('a', 'b'), e('b', 'ret')],
    );
    expect(topoOrder(graph)).toEqual(['meta', 'a', 'b', 'ret']);
  });

  it('is stable across identical graphs', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }), n.agent('a', { prompt: 'x' }),
       n.ret('ret', { source: 'a', transform: 'none' })],
      [e('meta', 'a'), e('a', 'ret')],
    );
    expect(topoOrder(graph)).toEqual(topoOrder(graph));
  });
});

// ---------------------------------------------------------------------------
// bindingNames + producesBinding — id → JS const name.
// ---------------------------------------------------------------------------
describe('bindingNames', () => {
  it('derives a camelCase binding from the node label', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('a', { prompt: 'x' }, 'List routes'),
       n.ret('ret', { source: 'a', transform: 'none' })],
      [e('meta', 'a'), e('a', 'ret')],
    );
    expect(bindingNames(graph).get('a')).toBe('listRoutes');
  });

  it('suffixes colliding names by topo index', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('a', { prompt: 'x' }, 'Run'),
       n.agent('b', { prompt: 'y' }, 'Run'),
       n.ret('ret', { source: 'b', transform: 'none' })],
      [e('meta', 'a'), e('a', 'b'), e('b', 'ret')],
    );
    const names = bindingNames(graph);
    expect(names.get('a')).toBe('run');
    expect(names.get('b')).toMatch(/^run_\d+$/);
    expect(names.get('a')).not.toBe(names.get('b'));
  });

  it('suffixes a reserved-word label so the binding is a valid identifier', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('a', { prompt: 'x' }, 'delete'),
       n.ret('ret', { source: 'a', transform: 'none' })],
      [e('meta', 'a'), e('a', 'ret')],
    );
    expect(bindingNames(graph).get('a')).toBe('delete_');
  });

  it('assigns no binding to meta / branch / return', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }), n.agent('a', { prompt: 'x' }),
       n.ret('ret', { source: 'a', transform: 'none' })],
      [e('meta', 'a'), e('a', 'ret')],
    );
    const names = bindingNames(graph);
    expect(names.has('meta')).toBe(false);
    expect(names.has('ret')).toBe(false);
    expect(names.get('a')).toBeDefined();
  });

  it('producesBinding is true only for agent/pipeline/loopUntilCheck', () => {
    expect(producesBinding(n.agent('a', { prompt: 'x' }))).toBe(true);
    expect(producesBinding(n.pipeline('p', { source: 'args', itemPrompt: 'x' }))).toBe(true);
    expect(producesBinding(n.loop('l', { checkPrompt: 'c', fixPrompt: 'f', passField: 'passed', maxRounds: 2 }))).toBe(true);
    expect(producesBinding(n.meta('m', { name: 't', description: 'd' }))).toBe(false);
    expect(producesBinding(n.branch('b', { source: 'a', field: 'ok' }))).toBe(false);
    expect(producesBinding(n.ret('r', { source: 'a', transform: 'none' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// linearize — nodes in execution order with their bindings.
// ---------------------------------------------------------------------------
describe('linearize', () => {
  it('returns nodes in topo order with bindings on producing kinds', () => {
    const graph = g(
      [n.meta('meta', { name: 't', description: 'd' }), n.agent('a', { prompt: 'x' }),
       n.ret('ret', { source: 'a', transform: 'none' })],
      [e('meta', 'a'), e('a', 'ret')],
    );
    const lin = linearize(graph);
    expect(lin.map((l) => l.node.id)).toEqual(['meta', 'a', 'ret']);
    expect(lin.find((l) => l.node.id === 'a')!.binding).toBeDefined();
    expect(lin.find((l) => l.node.id === 'ret')!.binding).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// branchCondition — the if() expression.
// ---------------------------------------------------------------------------
describe('branchCondition', () => {
  const names = new Map([['review', 'review']]);
  it('reads source.field', () => {
    expect(branchCondition({ source: 'review', field: 'safe' }, names)).toBe('review.safe');
  });
  it('wraps in !() when negated', () => {
    expect(branchCondition({ source: 'review', field: 'safe', negate: true }, names)).toBe('!(review.safe)');
  });
});

// ---------------------------------------------------------------------------
// emitWorkflow — the JS script emitter (structure + escaping).
// ---------------------------------------------------------------------------
describe('emitWorkflow', () => {
  const file = (graph: Parameters<typeof emitWorkflow>[0]) => emitWorkflow(graph);

  it('writes the header, meta export, and an agent const', () => {
    const out = file(g(
      [n.meta('meta', { name: 'my-flow', description: 'Desc.' }, 'Root'),
       n.agent('a', { prompt: 'Do it.' }, 'Step'),
       n.ret('ret', { source: 'a', transform: 'none' })],
      [e('meta', 'a'), e('a', 'ret')],
    ));
    expect(out.path).toBe('.claude/workflows/t.js');
    expect(out.content).toContain('export const meta = { name: "my-flow", description: "Desc." }');
    expect(out.content).toContain('const step = await agent(`Do it.`');
    expect(out.content).toContain('return step');
    expect(out.content.endsWith('\n')).toBe(true);
  });

  it('escapes backticks and ${ in user prompt text', () => {
    const out = file(g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('a', { prompt: 'Backtick ` and ${dollar} literal.' }),
       n.ret('ret', { source: 'a', transform: 'none' })],
      [e('meta', 'a'), e('a', 'ret')],
    ));
    expect(out.content).toContain('Backtick \\` and \\${dollar} literal.');
  });

  it('resolves {{args}} and upstream {{ref}} to interpolations', () => {
    const out = file(g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('a', { prompt: 'Produce.' }),
       n.agent('b', { prompt: 'Use {{args}} and {{a}}.' }),
       n.ret('ret', { source: 'b', transform: 'none' })],
      [e('meta', 'a'), e('a', 'b'), e('b', 'ret')],
    ));
    expect(out.content).toContain('${JSON.stringify(args)}');
    expect(out.content).toContain('${JSON.stringify(a)}');
  });

  it('emits a loopUntilCheck as a bounded while loop', () => {
    const out = file(g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.loop('loop', {
         checkPrompt: 'Check.',
         checkSchema: { type: 'object', properties: { passed: { type: 'boolean' } } },
         passField: 'passed', fixPrompt: 'Fix {{check}}.', maxRounds: 3,
       }),
       n.ret('ret', { source: 'loop', transform: 'none' })],
      [e('meta', 'loop'), e('loop', 'ret')],
    ));
    expect(out.content).toContain('while (round < 3)');
    expect(out.content).toContain('if (check.passed) break');
    expect(out.content).toContain('${JSON.stringify(check)}');
  });

  it('emits a branch as if/else guarding each arm', () => {
    const out = file(g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('review', { prompt: 'Review.', schema: { type: 'object', properties: { safe: { type: 'boolean' } } } }),
       n.branch('br', { source: 'review', field: 'safe' }),
       n.agent('approve', { prompt: 'Approve.' }),
       n.agent('request', { prompt: 'Request.' }),
       n.ret('ret', { source: 'review', transform: 'none' })],
      [e('meta', 'review'), e('review', 'br'),
       e('br', 'approve', 'then'), e('br', 'request', 'else'), e('br', 'ret')],
    ));
    expect(out.content).toContain('if (review.safe) {');
    expect(out.content).toContain('} else {');
  });

  it('emits a NESTED branch as its own if/else, not flattened (B4)', () => {
    const out = file(g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('r1', { prompt: 'root', schema: { type: 'object', properties: { a: { type: 'boolean' } } } }),
       n.branch('b1', { source: 'r1', field: 'a' }),
       n.agent('r2', { prompt: 'then-entry', schema: { type: 'object', properties: { b: { type: 'boolean' } } } }),
       n.branch('b2', { source: 'r2', field: 'b' }),
       n.agent('x', { prompt: 'inner-then' }),
       n.agent('y', { prompt: 'inner-else' }),
       n.agent('z', { prompt: 'outer-else' }),
       n.ret('ret', { source: 'r1', transform: 'none' })],
      [e('meta', 'r1'), e('r1', 'b1'),
       e('b1', 'r2', 'then'), e('b1', 'z', 'else'),
       e('r2', 'b2'), e('b2', 'x', 'then'), e('b2', 'y', 'else'),
       e('b1', 'ret')],
    ));
    // The inner conditional survives (both inner-arm agents are guarded by r2.b),
    // and the two nested arms are NOT emitted unconditionally side by side.
    expect(out.content).toContain('if (r1.a) {');
    expect(out.content).toContain('if (r2.b) {');
    // inner-then must be nested (indented deeper than the inner if), not top-level.
    expect(out.content).toMatch(/if \(r2\.b\) \{\n {4}const x = /);
  });

  it('applies the return transform (filterBoolean → .filter(Boolean))', () => {
    const out = file(g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('a', { prompt: 'List.', schema: { type: 'object', properties: { files: { type: 'array' } } } }),
       n.pipeline('pipe', { source: 'a', sourceField: 'files', itemPrompt: 'Do {{item}}.', itemLabel: '{{item}}' }),
       n.ret('ret', { source: 'pipe', transform: 'filterBoolean' })],
      [e('meta', 'a'), e('a', 'pipe'), e('pipe', 'ret')],
    ));
    expect(out.content).toContain('.filter(Boolean)');
  });
});
