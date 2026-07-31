import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflowJs } from '../src/import-js.js';
import { generate } from '../src/codegen/index.js';
import { validateGraph } from '../src/validate.js';
import { TEMPLATES } from '../src/templates.js';

const here = dirname(fileURLToPath(import.meta.url));
const jsOf = (files: ReturnType<typeof generate>) => files.find((f) => f.path.endsWith('.js'))!.content;

// ---------------------------------------------------------------------------
// Inverse property: parse(emit(g)) re-emits byte-identical for the whole gallery.
// (The parser is the exact inverse of the emitter for its own structured output;
// while/if fall back to raw and still round-trip verbatim.)
// ---------------------------------------------------------------------------
describe('parseWorkflowJs — gallery round-trip (byte-identical)', () => {
  for (const t of TEMPLATES) {
    it(`${t.slug}: parse(.js) → generate() is byte-identical`, () => {
      const orig = jsOf(generate(t.graph));
      const graph = parseWorkflowJs(orig, t.slug);
      expect(graph, `${t.slug} parsed to null`).not.toBeNull();
      expect(jsOf(generate(graph!))).toBe(orig);
    });
  }

  it('reconstructs typed nodes for the structured subset', () => {
    const orig = jsOf(generate(TEMPLATES.find((t) => t.slug === 'audit-routes')!.graph));
    const g = parseWorkflowJs(orig, 'audit-routes')!;
    expect(g.nodes.map((n) => n.kind)).toEqual(['workflow.meta', 'agent', 'pipeline', 'output.return']);
  });

  it('falls back to a raw node for the while-loop shape (test-fix)', () => {
    const orig = jsOf(generate(TEMPLATES.find((t) => t.slug === 'test-fix')!.graph));
    const g = parseWorkflowJs(orig, 'test-fix')!;
    expect(g.nodes.some((n) => n.kind === 'raw')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// M8: first-class parallel() modeling + opts passthrough.
// ---------------------------------------------------------------------------
describe('parseWorkflowJs — parallel() (M8)', () => {
  // Build the canonical script via a graph → generate(), then parse THAT back
  // (the parser is the exact inverse of the emitter for its own output).
  const parallelGraph = {
    version: 1 as const,
    meta: { name: 'rev', slug: 'rev' },
    settings: {},
    nodes: [
      { id: 'meta', kind: 'workflow.meta' as const, label: 'rev', position: { x: 0, y: 0 }, data: { name: 'rev', description: 'd' } },
      { id: 'list', kind: 'agent' as const, label: 'list', position: { x: 0, y: 0 }, data: { prompt: 'List.', schema: { type: 'object', properties: { items: { type: 'array' } } } } },
      { id: 'reviews', kind: 'parallel' as const, label: 'reviews', position: { x: 0, y: 0 }, data: { source: 'list', sourceField: 'items', itemVar: 'd', itemPrompt: 'Review {{d}}.', itemLabel: 'rev {{d}}', extraOpts: { phase: "'Review'" } } },
      { id: 'ret', kind: 'output.return' as const, label: 'ret', position: { x: 0, y: 0 }, data: { source: 'reviews', transform: 'none' as const } },
    ],
    edges: [
      { id: 'e1', source: 'meta', target: 'list' },
      { id: 'e2', source: 'list', target: 'reviews' },
      { id: 'e3', source: 'reviews', target: 'ret' },
    ],
  };
  const src = jsOf(generate(parallelGraph));

  it('types a parallel(SOURCE.map(v => () => agent(...))) call', () => {
    const g = parseWorkflowJs(src, 'rev')!;
    const par = g.nodes.find((n) => n.kind === 'parallel');
    expect(par, 'no parallel node').toBeDefined();
    if (par!.kind !== 'parallel') throw new Error('kind');
    expect(par!.data.source).toBe('list');
    expect(par!.data.sourceField).toBe('items');
    expect(par!.data.itemVar).toBe('d'); // preserves the .map param name
    expect(par!.data.itemPrompt).toBe('Review {{d}}.');
    expect(par!.data.itemLabel).toBe('rev {{d}}');
    expect(par!.data.extraOpts).toEqual({ phase: "'Review'" }); // passthrough opt, verbatim
  });

  it('round-trips a parallel workflow byte-identical', () => {
    expect(jsOf(generate(parseWorkflowJs(src, 'rev')!))).toBe(src);
  });

  it('preserves unmodeled agent opts (phase/effort) as passthrough instead of raw', () => {
    const g0 = {
      version: 1 as const, meta: { name: 'x', slug: 'x' }, settings: {},
      nodes: [
        { id: 'meta', kind: 'workflow.meta' as const, label: 'x', position: { x: 0, y: 0 }, data: { name: 'x', description: 'd' } },
        { id: 'draft', kind: 'agent' as const, label: 'draft', position: { x: 0, y: 0 }, data: { prompt: 'Write it.', label: 'd', extraOpts: { phase: "'Synthesize'", effort: "'high'" } } },
        { id: 'ret', kind: 'output.return' as const, label: 'ret', position: { x: 0, y: 0 }, data: { source: 'draft', transform: 'none' as const } },
      ],
      edges: [{ id: 'e1', source: 'meta', target: 'draft' }, { id: 'e2', source: 'draft', target: 'ret' }],
    };
    const s = jsOf(generate(g0));
    const g = parseWorkflowJs(s, 'x')!;
    const a = g.nodes.find((n) => n.kind === 'agent');
    expect(a, 'agent fell back to raw').toBeDefined();
    if (a!.kind !== 'agent') throw new Error('kind');
    expect(a!.data.extraOpts).toEqual({ phase: "'Synthesize'", effort: "'high'" });
    expect(jsOf(generate(g))).toBe(s); // byte-identical
  });

  it('types a FUNCTION-CALL prompt as an agent via promptExpr (visualization-first)', () => {
    // agent(researchPrompt(d), …) can't be a template — it becomes an agent node
    // whose prompt is the verbatim expression, re-emitted as-is (round-trip).
    const g0 = {
      version: 1 as const, meta: { name: 'x', slug: 'x' }, settings: {},
      nodes: [
        { id: 'meta', kind: 'workflow.meta' as const, label: 'x', position: { x: 0, y: 0 }, data: { name: 'x', description: 'd' } },
        { id: 'r', kind: 'raw' as const, label: 'code', position: { x: 0, y: 0 }, data: { code: 'const build = t => `do ${t}`', produces: ['build'] } },
        { id: 'a', kind: 'agent' as const, label: 'step', position: { x: 0, y: 0 }, data: { promptExpr: 'build("x")', label: 'go' } },
        { id: 'ret', kind: 'output.return' as const, label: 'ret', position: { x: 0, y: 0 }, data: { source: 'a', transform: 'none' as const } },
      ],
      edges: [{ id: 'e1', source: 'meta', target: 'r' }, { id: 'e2', source: 'r', target: 'a' }, { id: 'e3', source: 'a', target: 'ret' }],
    };
    const s = jsOf(generate(g0));
    // emitted agent must use the bare expression (no backticks around it).
    expect(s).toContain('agent(build("x"), {');
    const g = parseWorkflowJs(s, 'x')!;
    const a = g.nodes.find((n) => n.kind === 'agent');
    expect(a, 'function-call-prompt agent fell to raw').toBeDefined();
    if (a!.kind !== 'agent') throw new Error('kind');
    expect(a!.data.promptExpr).toBe('build("x")');
    expect(a!.data.prompt).toBeUndefined();
    expect(jsOf(generate(g))).toBe(s); // round-trips byte-identical
  });

  it("keeps a prompt containing literal {{...}} as promptExpr (no ambiguous re-parse)", () => {
    // A template whose OWN text has `{{x}}` can't round-trip through our ref scheme,
    // so it stays a verbatim promptExpr rather than being mis-read as a ref.
    const g0 = {
      version: 1 as const, meta: { name: 'x', slug: 'x' }, settings: {},
      nodes: [
        { id: 'meta', kind: 'workflow.meta' as const, label: 'x', position: { x: 0, y: 0 }, data: { name: 'x', description: 'd' } },
        { id: 'a', kind: 'agent' as const, label: 'a', position: { x: 0, y: 0 }, data: { promptExpr: '`use {{x.y}} literally`' } },
        { id: 'ret', kind: 'output.return' as const, label: 'ret', position: { x: 0, y: 0 }, data: { source: 'a', transform: 'none' as const } },
      ],
      edges: [{ id: 'e1', source: 'meta', target: 'a' }, { id: 'e2', source: 'a', target: 'ret' }],
    };
    const s = jsOf(generate(g0));
    const g = parseWorkflowJs(s, 'x')!;
    const a = g.nodes.find((n) => n.kind === 'agent');
    if (a!.kind !== 'agent') throw new Error('kind');
    expect(a!.data.promptExpr).toBe('`use {{x.y}} literally`'); // stayed verbatim, not a ref
    expect(a!.data.prompt).toBeUndefined();
    expect(jsOf(generate(g))).toBe(s); // byte-identical; no CF605 misfire
  });
});

// ---------------------------------------------------------------------------
// Real, complex, hand-authored workflow: not necessarily byte-identical, but
// must parse to a valid graph that re-generates a self-lint-passing workflow.
// ---------------------------------------------------------------------------
describe('parseWorkflowJs — real hand-authored workflow (ironclad)', () => {
  const src = readFileSync(join(here, 'import-fixtures', 'ironclad.js'), 'utf8');

  it('parses to a graph (meta + raw), not null', () => {
    const g = parseWorkflowJs(src, 'ironclad');
    expect(g).not.toBeNull();
    expect(g!.nodes[0]!.kind).toBe('workflow.meta');
    expect(g!.nodes.some((n) => n.kind === 'raw')).toBe(true);
  });

  it('preserves the meta name + description', () => {
    const g = parseWorkflowJs(src, 'ironclad')!;
    const meta = g.nodes.find((n) => n.kind === 'workflow.meta')!;
    if (meta.kind !== 'workflow.meta') throw new Error('kind');
    expect(meta.data.name).toBe('ironclad-basketball-stats-solution');
    expect(meta.data.description).toMatch(/PROVEN/);
  });

  it('re-generates a valid, self-lint-passing workflow (does not throw)', () => {
    const g = parseWorkflowJs(src, 'ironclad')!;
    const out = generate(g);
    const js = jsOf(out);
    // The raw block carries the body verbatim, including the complex return.
    expect(js).toContain('await pipeline(');
    expect(js).toContain('for (const j of judgings)');
    expect(js).toMatch(/return \{[\s\S]*ranking: ranked/); // the workflow's final object return
  });

  it('carries raw-declared bindings in produces (across the per-statement raw nodes)', () => {
    const g = parseWorkflowJs(src, 'ironclad')!;
    const produced = g.nodes.flatMap((n) => (n.kind === 'raw' ? (n.data.produces ?? []) : []));
    // Setup consts (schemas etc.) stay raw and are declared there.
    expect(produced).toContain('results');
    expect(produced).toContain('FINDINGS_SCHEMA');
  });

  it('types the synthesis chain (programmatic prompts) as agent nodes, not raw (M8)', () => {
    const g = parseWorkflowJs(src, 'ironclad')!;
    const agentLabels = g.nodes.filter((n) => n.kind === 'agent').map((n) => n.label);
    // draft/critique/final are agent() calls the visualizer now types (via promptExpr
    // or template), instead of dropping them into raw code blocks.
    expect(agentLabels).toEqual(expect.arrayContaining(['draft', 'critique', 'final']));
  });

  it('splits the body into MANY per-statement blocks, not one blob (M8)', () => {
    const g = parseWorkflowJs(src, 'ironclad')!;
    // The 219-line workflow becomes dozens of ordered nodes (was meta + 1 raw in M7).
    expect(g.nodes.length).toBeGreaterThan(20);
    expect(g.nodes[0]!.kind).toBe('workflow.meta');
  });
});

// ---------------------------------------------------------------------------
// Round-trip fidelity regressions (from the M7 code review).
// ---------------------------------------------------------------------------
describe('parseWorkflowJs — round-trip fidelity', () => {
  it('B1: a prompt ref to a RAW-declared binding re-emits verbatim, never literal {{…}}', () => {
    const src = [
      "export const meta = { name: 'demo', description: 'd' }",
      'const topic = args.topic', // → raw node, produces ['topic']
      'const summary = await agent(`Summarize ${topic} now.`)',
      'return summary',
      '',
    ].join('\n');
    const g = parseWorkflowJs(src, 'demo')!;
    const out = jsOf(generate(g));
    expect(out).toContain('${topic}'); // preserved as an interpolation
    expect(out).not.toContain('{{topic}}'); // NOT corrupted into literal text
  });

  it('B1: a JSON.stringify ref to a raw binding also stays verbatim', () => {
    const src = [
      "export const meta = { name: 'demo', description: 'd' }",
      'const ctx = args.ctx',
      'const out = await agent(`Use ${JSON.stringify(ctx)}.`)',
      'return out',
      '',
    ].join('\n');
    const out = jsOf(generate(parseWorkflowJs(src, 'demo')!));
    expect(out).toContain('${JSON.stringify(ctx)}');
    expect(out).not.toContain('{{ctx}}');
  });

  it('M1: destructuring defaults + array rest are captured in produces', () => {
    const src = [
      "export const meta = { name: 'demo', description: 'd' }",
      "const { topic = 'x' } = args",
      'const [first, ...rest] = args.items',
      'return { topic, first, rest }',
      '',
    ].join('\n');
    const g = parseWorkflowJs(src, 'demo')!;
    // M8: one raw node per statement, so produces is spread across the raw nodes.
    const produced = g.nodes.flatMap((n) => (n.kind === 'raw' ? (n.data.produces ?? []) : []));
    expect(produced).toEqual(expect.arrayContaining(['topic', 'first', 'rest']));
  });

  it('M3: interstitial comments inside a raw group are preserved on re-export', () => {
    const src = [
      "export const meta = { name: 'demo', description: 'd' }",
      'const a = 1',
      '// IMPORTANT: keep this comment',
      'const b = 2',
      'return { a, b }',
      '',
    ].join('\n');
    const out = jsOf(generate(parseWorkflowJs(src, 'demo')!));
    expect(out).toContain('// IMPORTANT: keep this comment');
  });

  it('B3: a raw block using arbitrary JS globals generates (no SelfLintError)', () => {
    // throw new Error(...) / parseInt(...) are idiomatic in real workflows; the
    // raw block is opaque, so its identifiers are exempt from self-lint resolution.
    const src = [
      "export const meta = { name: 'guard', description: 'd' }",
      "if (!args.n) { throw new Error('missing n') }",
      'const count = parseInt(args.n, 10)',
      'const r = await agent(`Do ${count} things.`)',
      'return r',
      '',
    ].join('\n');
    const g = parseWorkflowJs(src, 'guard')!;
    // Must NOT throw a SelfLintError — generate() succeeds.
    const out = jsOf(generate(g));
    expect(out).toContain('throw new Error');
    expect(out).toContain('parseInt(args.n, 10)');
  });

  it('B4: two identical raw blocks are both exempt (no SelfLintError)', () => {
    // A repeated un-typed line (e.g. a progress marker) produces two identical raw
    // nodes. Emitter records each block's exact span, so BOTH are exempt — the
    // second no longer falls to the strict check and crash generate(). `log()` is an
    // undocumented runtime global (not allowlisted, not typed) → stays raw.
    const src = [
      "export const meta = { name: 'analyze', description: 'd' }",
      "log('start')", // runtime global, not allowlisted → must be exempt
      'const a = await agent(`step 1`)',
      "log('start')", // identical raw line → a second raw node
      'const b = await agent(`step 2`)',
      'return b',
      '',
    ].join('\n');
    const g = parseWorkflowJs(src, 'analyze')!;
    expect(g.nodes.filter((n) => n.kind === 'raw')).toHaveLength(2);
    const out = jsOf(generate(g)); // must not throw
    expect((out.match(/log\('start'\)/g) ?? []).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// M8 review — round-trip corruption + injection regressions.
// ---------------------------------------------------------------------------
describe('parseWorkflowJs — M8 review regressions', () => {
  // Build the canonical script from a graph so comparisons are against real output.
  const rt = (nodes: unknown[], edges: unknown[]) => {
    const g0 = { version: 1 as const, meta: { name: 'x', slug: 'x' }, settings: {}, nodes, edges } as never;
    const src = jsOf(generate(g0));
    return { src, re: jsOf(generate(parseWorkflowJs(src, 'x')!)) };
  };
  const meta = { id: 'm', kind: 'workflow.meta', label: 'x', position: { x: 0, y: 0 }, data: { name: 'x', description: 'd' } };
  const ret = (source: string) => ({ id: 'ret', kind: 'output.return', label: 'ret', position: { x: 0, y: 0 }, data: { source, transform: 'none' } });

  it('B1: a kebab/quoted agent opt key falls to raw (never emits invalid JS)', () => {
    const src = 'export const meta = { name: "x", description: "d" }\nconst a = await agent(`x`, { \'agent-type\': \'r\' })\nreturn a\n';
    const g = parseWorkflowJs(src, 'x')!;
    expect(g.nodes.some((n) => n.kind === 'agent')).toBe(false); // fell to raw
    expect(() => generate(g)).not.toThrow(); // no SelfLintError from invalid JS
  });

  it('B2: parallel itemVar shadowing a node binding round-trips (JSON.stringify preserved)', () => {
    const { src, re } = rt(
      [meta,
       { id: 'd', kind: 'agent', label: 'd', position: { x: 0, y: 0 }, data: { prompt: 'produce', schema: { type: 'object', properties: { items: { type: 'array' } } } } },
       { id: 'p', kind: 'parallel', label: 'r', position: { x: 0, y: 0 }, data: { source: 'd', sourceField: 'items', itemVar: 'd', itemPrompt: 'Use {{d}}.', itemLabel: '{{d}}' } },
       ret('p')],
      [{ id: 'e1', source: 'm', target: 'd' }, { id: 'e2', source: 'd', target: 'p' }, { id: 'e3', source: 'p', target: 'ret' }],
    );
    expect(re).toBe(src);
  });

  it('B3: a per-item field ref (${item.field}) round-trips, not a literal', () => {
    const { src, re } = rt(
      [meta,
       { id: 'p', kind: 'parallel', label: 'r', position: { x: 0, y: 0 }, data: { source: 'args', itemVar: 'item', itemPrompt: 'Review {{item.name}} now.', itemLabel: '{{item}}' } },
       ret('p')],
      [{ id: 'e1', source: 'm', target: 'p' }, { id: 'e2', source: 'p', target: 'ret' }],
    );
    expect(src).toContain('${item.name}');
    expect(src).not.toContain('{{item.name}}');
    expect(re).toBe(src);
  });

  it('M1: an ${args.field} ref round-trips, not a literal', () => {
    const { src, re } = rt(
      [meta,
       { id: 'a', kind: 'agent', label: 'a', position: { x: 0, y: 0 }, data: { prompt: 'Target repo {{args.repo}}.' } },
       ret('a')],
      [{ id: 'e1', source: 'm', target: 'a' }, { id: 'e2', source: 'a', target: 'ret' }],
    );
    expect(src).toContain('${args.repo}');
    expect(src).not.toContain('{{args.repo}}');
    expect(re).toBe(src);
  });

  it('B7: a promptExpr using arbitrary JS builtins generates (self-lint exempt)', () => {
    // parseInt/new Error are not in the GLOBALS allowlist; a promptExpr is opaque
    // user JS, so its span is exempt — generate() must not throw a SelfLintError.
    const src = 'export const meta = { name: "x", description: "d" }\nconst a = await agent(`Do ${parseInt(args.n)} via ${new Error("e")}.`)\nreturn a\n';
    const g = parseWorkflowJs(src, 'x')!;
    expect(g.nodes.some((n) => n.kind === 'agent')).toBe(true); // typed via promptExpr
    expect(() => generate(g)).not.toThrow();
    expect(jsOf(generate(g))).toContain('parseInt(args.n)');
  });

  it('B10: exempt span is anchored on agent( — not a same-text substring in the binding', () => {
    // Binding `ab` contains the promptExpr text `a`; the exempt span must cover the
    // ARGUMENT `a` (after `agent(`), not the `a` inside the binding name.
    const g0 = {
      version: 1 as const, meta: { name: 'x', slug: 'x' }, settings: {},
      nodes: [
        meta,
        { id: 'raw', kind: 'raw', label: 'code', position: { x: 0, y: 0 }, data: { code: 'const a = 1', produces: ['a'] } },
        { id: 'ab', kind: 'agent', label: 'ab', position: { x: 0, y: 0 }, data: { promptExpr: 'a' } },
        ret('ab'),
      ],
      edges: [{ id: 'e1', source: 'm', target: 'raw' }, { id: 'e2', source: 'raw', target: 'ab' }, { id: 'e3', source: 'ab', target: 'ret' }],
    } as never;
    expect(() => generate(g0)).not.toThrow(); // no false-positive self-lint on the binding's 'a'
    expect(jsOf(generate(g0))).toContain('const ab = await agent(a)');
  });

  it('B8: a sequence-expression prompt arg falls to raw (parens not lost)', () => {
    const src = 'export const meta = { name: "x", description: "d" }\nconst a = await agent((foo, bar), { label: \'z\' })\nreturn a\n';
    const g = parseWorkflowJs(src, 'x')!;
    expect(g.nodes.some((n) => n.kind === 'agent')).toBe(false); // stayed raw
  });

  it('B9: an agent with neither prompt nor promptExpr is flagged (CF604) and blocked', () => {
    const g0 = {
      version: 1 as const, meta: { name: 'x', slug: 'x' }, settings: {},
      nodes: [meta, { id: 'a', kind: 'agent', label: 'a', position: { x: 0, y: 0 }, data: { label: 'x' } }, ret('a')],
      edges: [{ id: 'e1', source: 'm', target: 'a' }, { id: 'e2', source: 'a', target: 'ret' }],
    } as never;
    expect(validateGraph(g0).some((d) => d.ruleId === 'CF604')).toBe(true);
    expect(() => generate(g0)).toThrow(); // export gate blocks the empty prompt
  });
});

// ---------------------------------------------------------------------------
// M9: structural view — phase() groups + branch-from-if.
// ---------------------------------------------------------------------------
describe('parseWorkflowJs — phase groups (M9)', () => {
  // meta + two phases each wrapping one agent, then a return. Built from a graph so
  // the source is canonical emitter output (byte-identity is a fair claim).
  const phaseGraph = {
    version: 1 as const, meta: { name: 'poc', slug: 'poc' }, settings: {},
    nodes: [
      { id: 'm', kind: 'workflow.meta' as const, label: 'poc', position: { x: 0, y: 0 }, data: { name: 'poc', description: 'd' } },
      { id: 'p1', kind: 'phase' as const, label: 'understand', position: { x: 0, y: 0 }, data: { title: 'Understand' } },
      { id: 'a1', kind: 'agent' as const, label: 'spec', position: { x: 0, y: 0 }, parentId: 'p1', data: { prompt: 'Write a spec.' } },
      { id: 'p2', kind: 'phase' as const, label: 'build', position: { x: 0, y: 0 }, data: { title: 'Build' } },
      { id: 'a2', kind: 'agent' as const, label: 'build', position: { x: 0, y: 0 }, parentId: 'p2', data: { prompt: 'Build from {{a1}}.' } },
      { id: 'ret', kind: 'output.return' as const, label: 'ret', position: { x: 0, y: 0 }, data: { source: 'a2', transform: 'none' as const } },
    ],
    edges: [
      { id: 'e1', source: 'm', target: 'p1' }, { id: 'e2', source: 'p1', target: 'a1' },
      { id: 'e3', source: 'a1', target: 'p2' }, { id: 'e4', source: 'p2', target: 'a2' },
      { id: 'e5', source: 'a2', target: 'ret' },
    ],
  };
  const src = jsOf(generate(phaseGraph));

  it('emits phase() markers that hug their first member', () => {
    expect(src).toContain('phase("Understand")\nconst spec');
    expect(src).toContain('phase("Build")\nconst build');
  });

  it('parses phase() markers into phase nodes with members parented to them', () => {
    const g = parseWorkflowJs(src, 'poc')!;
    const phases = g.nodes.filter((n) => n.kind === 'phase');
    expect(phases.map((p) => (p.kind === 'phase' ? p.data.title : ''))).toEqual(['Understand', 'Build']);
    const spec = g.nodes.find((n) => n.kind === 'agent' && n.label.includes('spec'));
    // the agent after phase('Understand') is parented to that phase node
    expect(spec?.parentId).toBe(phases[0]!.id);
  });

  it('round-trips a phase-grouped workflow byte-identical', () => {
    expect(jsOf(generate(parseWorkflowJs(src, 'poc')!))).toBe(src);
  });
});

describe('parseWorkflowJs — branch from a real if (M9)', () => {
  it('reconstructs an if that gates an agent as a branch with a verbatim condExpr', () => {
    const src = [
      'export const meta = { name: "verify", description: "d" }',
      'const verdicts = await agent(`check`)',
      'if (verdicts.failing) {',
      '  const repair = await agent(`fix ${JSON.stringify(verdicts)}`)',
      '}',
      'return verdicts',
      '',
    ].join('\n');
    const g = parseWorkflowJs(src, 'verify')!;
    const br = g.nodes.find((n) => n.kind === 'branch');
    expect(br, 'no branch node').toBeDefined();
    if (br!.kind !== 'branch') throw new Error('kind');
    expect(br!.data.condExpr).toBe('verdicts.failing'); // verbatim condition
    // the repair agent is on the `then` arm
    const thenEdge = g.edges.find((e) => e.source === br!.id && e.sourceHandle === 'then');
    expect(thenEdge).toBeDefined();
    expect(() => generate(g)).not.toThrow(); // valid + self-lint-passing
  });

  it('keeps a pure data-munging if as raw (no orchestration to gate)', () => {
    const src = [
      'export const meta = { name: "reduce", description: "d" }',
      'const data = await agent(`get`)',
      'if (data.items.length > 3) { data.trimmed = true }',
      'return data',
      '',
    ].join('\n');
    const g = parseWorkflowJs(src, 'reduce')!;
    expect(g.nodes.some((n) => n.kind === 'branch')).toBe(false);
    expect(g.nodes.some((n) => n.kind === 'raw')).toBe(true);
  });

  it('keeps an if whose arm has a direct return as raw (would double the return)', () => {
    const src = [
      'export const meta = { name: "guard", description: "d" }',
      'const r = await agent(`check`)',
      'if (!r.ok) { const x = await agent(`log`); return x }',
      'return r',
      '',
    ].join('\n');
    const g = parseWorkflowJs(src, 'guard')!;
    // Not lifted to a branch (the arm's `return` would create a second top-level return).
    expect(g.nodes.some((n) => n.kind === 'branch')).toBe(false);
  });

  it('a branch parsed from an if reaches a re-emit FIXPOINT after one round', () => {
    // Tier-3 contract: not byte-identical to hand-authored source, but idempotent.
    const src = [
      'export const meta = { name: "fp", description: "d" }',
      'const r = await agent(`check`)',
      'if (r.failing) {',
      '  const fix = await agent(`repair`)',
      '} else {',
      '  const ok = await agent(`approve`)',
      '}',
      'return r',
      '',
    ].join('\n');
    const once = jsOf(generate(parseWorkflowJs(src, 'fp')!));
    const twice = jsOf(generate(parseWorkflowJs(once, 'fp')!));
    expect(twice).toBe(once); // fixpoint: re-import/re-export is stable
  });

  it('a MULTI-LINE raw statement inside a branch arm reaches a fixpoint (no indent creep)', () => {
    // Regression: an arm-nested raw block keeps its source indent on continuation
    // lines; emitBranch adds +2 per line, so without dedent-on-capture the indent
    // grew every round and never converged (found in the biorce corpus workflow).
    const src = [
      'export const meta = { name: "fp2", description: "d" }',
      'const r = await agent(`check`)',
      'if (r.failing) {',
      '  const fix = await agent(',
      '    `line one',
      '     line two`,',
      "    { label: 'x' }",
      '  )',
      '}',
      'return r',
      '',
    ].join('\n');
    const once = jsOf(generate(parseWorkflowJs(src, 'fp2')!));
    const twice = jsOf(generate(parseWorkflowJs(once, 'fp2')!));
    const thrice = jsOf(generate(parseWorkflowJs(twice, 'fp2')!));
    expect(twice).toBe(once);
    expect(thrice).toBe(twice); // stable across repeated round-trips
  });
});

// ---------------------------------------------------------------------------
// Not-a-workflow inputs.
// ---------------------------------------------------------------------------
describe('parseWorkflowJs — non-workflows', () => {
  it('returns null when there is no export const meta', () => {
    expect(parseWorkflowJs('const x = 1\nexport default x\n', 'x')).toBeNull();
  });

  it('returns null on unparseable JS', () => {
    expect(parseWorkflowJs('export const meta = {\nconst a = (\n', 'x')).toBeNull();
  });
});
