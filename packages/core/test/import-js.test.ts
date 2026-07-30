import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflowJs } from '../src/import-js.js';
import { generate } from '../src/codegen/index.js';
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
    expect(produced).toContain('results');
    expect(produced).toContain('final');
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
    // second no longer falls to the strict check and crash generate().
    const src = [
      "export const meta = { name: 'analyze', description: 'd' }",
      "phase('start')", // runtime global, not allowlisted → must be exempt
      'const a = await agent(`step 1`)',
      "phase('start')", // identical raw line → a second raw node
      'const b = await agent(`step 2`)',
      'return b',
      '',
    ].join('\n');
    const g = parseWorkflowJs(src, 'analyze')!;
    expect(g.nodes.filter((n) => n.kind === 'raw')).toHaveLength(2);
    const out = jsOf(generate(g)); // must not throw
    expect((out.match(/phase\('start'\)/g) ?? []).length).toBe(2);
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
