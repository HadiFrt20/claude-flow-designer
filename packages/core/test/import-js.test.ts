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

  it('carries the raw block’s declared bindings in produces', () => {
    const g = parseWorkflowJs(src, 'ironclad')!;
    const raw = g.nodes.find((n) => n.kind === 'raw')!;
    if (raw.kind !== 'raw') throw new Error('kind');
    expect(raw.data.produces).toContain('results');
    expect(raw.data.produces).toContain('final');
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
    const raw = g.nodes.find((n) => n.kind === 'raw')!;
    if (raw.kind !== 'raw') throw new Error('kind');
    expect(raw.data.produces).toEqual(expect.arrayContaining(['topic', 'first', 'rest']));
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
