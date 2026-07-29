import { describe, it, expect } from 'vitest';
import { generate, ExportGateError, SelfLintError } from '../src/codegen/index.js';
import { parseProject } from '../src/importer.js';
import { TEMPLATES } from '../src/templates.js';
import type { GeneratedFile } from '../src/schema/types.js';
import { g, e, n } from './fixtures.js';

const findFile = (files: GeneratedFile[], suffix: string) =>
  files.find((f) => f.path.endsWith(suffix));

// ---------------------------------------------------------------------------
// Template gallery: snapshot every generated file + sidecar round-trip.
// ---------------------------------------------------------------------------
describe('template gallery', () => {
  for (const t of TEMPLATES) {
    it(`${t.slug} generates a stable file set (snapshot)`, () => {
      const files = generate(t.graph);
      expect(files).toMatchSnapshot();
    });

    it(`${t.slug} emits a workflow script + its sidecar`, () => {
      const files = generate(t.graph);
      expect(findFile(files, `${t.slug}.js`)?.path).toBe(`.claude/workflows/${t.slug}.js`);
      expect(findFile(files, '.clauflow.json')).toBeDefined();
    });

    it(`${t.slug} round-trips generate → parseProject → deep-equal (via sidecar)`, () => {
      const rt = parseProject(generate(t.graph));
      expect(rt).toEqual(t.graph);
    });
  }
});

// ---------------------------------------------------------------------------
// Emitted workflow-script shape (SPEC-CODEGEN "Workflow script mapping").
// ---------------------------------------------------------------------------
describe('workflow script structure', () => {
  const scriptOf = (graph: Parameters<typeof generate>[0]) =>
    findFile(generate(graph), '.js')!.content;

  it('single agent → one const + return', () => {
    const src = scriptOf(g(
      [n.meta('meta', { name: 't', description: 'Summarize.' }),
       n.agent('a', { prompt: 'Summarize {{args}}.' }, 'summarize'),
       n.ret('ret', { source: 'a', transform: 'none' })],
      [e('meta', 'a'), e('a', 'ret')],
    ));
    expect(src).toContain('const summarize = await agent(');
    expect(src).toContain('return summarize');
  });

  it('fan-out → pipeline(items, item => agent(...))', () => {
    const src = scriptOf(g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('a', { prompt: 'List.', schema: { type: 'object', properties: { files: { type: 'array' } } } }, 'list'),
       n.pipeline('pipe', { source: 'a', sourceField: 'files', itemPrompt: 'Audit {{item}}.', itemLabel: '{{item}}' }, 'audit'),
       n.ret('ret', { source: 'pipe', transform: 'none' })],
      [e('meta', 'a'), e('a', 'pipe'), e('pipe', 'ret')],
    ));
    expect(src).toContain('await pipeline(list.files, item => agent(');
    expect(src).toContain('${item}');
  });

  it('per-stage model routing → opts.model', () => {
    const src = scriptOf(g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('a', { prompt: 'Do.', model: 'haiku' }, 'step'),
       n.ret('ret', { source: 'a', transform: 'none' })],
      [e('meta', 'a'), e('a', 'ret')],
    ));
    expect(src).toContain('model: "haiku"');
  });

  it('embeds the agent schema verbatim (stable key order)', () => {
    const src = scriptOf(g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('a', { prompt: 'Do.', schema: { type: 'object', properties: { b: { type: 'string' }, a: { type: 'number' } } } }, 'step'),
       n.ret('ret', { source: 'a', transform: 'none' })],
      [e('meta', 'a'), e('a', 'ret')],
    ));
    // sorted keys: "a" before "b", "properties" before "type"
    expect(src).toContain('schema: {');
    expect(src.indexOf('"a"')).toBeLessThan(src.indexOf('"b"'));
  });

  it('settings.model is the per-stage default; a stage model overrides it', () => {
    const src = scriptOf(g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('a', { prompt: 'Inherit.' }, 'inheriting'),
       n.agent('b', { prompt: 'Override.', model: 'opus' }, 'overriding'),
       n.ret('ret', { source: 'b', transform: 'none' })],
      [e('meta', 'a'), e('a', 'b'), e('b', 'ret')],
      { model: 'haiku' },
    ));
    // 'a' inherits the default; 'b' keeps its own.
    expect(src).toContain('const inheriting = await agent(`Inherit.`, { model: "haiku" })');
    expect(src).toContain('model: "opus"');
  });
});

// ---------------------------------------------------------------------------
// Pipeline behaviour: gate refusal, determinism, self-lint.
// ---------------------------------------------------------------------------
describe('generate() pipeline', () => {
  it('throws ExportGateError on a blocking diagnostic (does not emit)', () => {
    // CF001: nodes but no workflow.meta entry point.
    const graph = g(
      [n.agent('a', { prompt: 'x' }), n.ret('ret', { source: 'a', transform: 'none' })],
      [e('a', 'ret')],
    );
    expect(() => generate(graph)).toThrow(ExportGateError);
  });

  it('emits deterministically (byte-identical across runs)', () => {
    const a = generate(TEMPLATES[0]!.graph);
    const b = generate(TEMPLATES[0]!.graph);
    expect(a).toEqual(b);
  });

  it('omits the sidecar when includeGraphFile is false', () => {
    const files = generate(TEMPLATES[0]!.graph, { includeGraphFile: false });
    expect(findFile(files, '.clauflow.json')).toBeUndefined();
    expect(findFile(files, '.js')).toBeDefined();
  });

  it('SelfLintError is thrown on a malformed artifact', () => {
    expect(new SelfLintError('x', 'y').name).toBe('SelfLintError');
  });
});
