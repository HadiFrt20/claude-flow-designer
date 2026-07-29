import { describe, it, expect } from 'vitest';
import { selfLint, SelfLintError } from '../src/codegen/self-lint.js';
import type { GeneratedFile } from '../src/schema/types.js';

const ok = (over: Partial<GeneratedFile> & { path: string }): GeneratedFile => ({
  content: '',
  ...over,
});

// A minimal well-formed workflow script for the "accepts valid" cases.
const validScript = [
  '// header',
  'export const meta = { name: "t", description: "d" }',
  '',
  'const a = await agent(`Do it.`)',
  '',
  'return a',
  '',
].join('\n');

describe('selfLint path containment', () => {
  const unsafe = [
    '/etc/passwd',
    '.claude/../../escape.js',
    'a//b.json',
    '.claude\\workflows\\x.js',
    '../outside.json',
  ];
  for (const p of unsafe) {
    it(`rejects unsafe path ${p}`, () => {
      expect(() => selfLint([ok({ path: p, content: '{}\n' })])).toThrow(/unsafe path/);
    });
  }
  it('accepts a normal relative path', () => {
    expect(() => selfLint([ok({ path: '.claude/workflows/x.js', content: validScript })])).not.toThrow();
  });
});

describe('selfLint JSON', () => {
  it('accepts a valid JSON file', () => {
    expect(() => selfLint([ok({ path: 'x.clauflow.json', content: '{"a":1}\n' })])).not.toThrow();
  });

  it('rejects invalid JSON with a descriptive message', () => {
    expect(() => selfLint([ok({ path: 'x.clauflow.json', content: '{bad}\n' })])).toThrow(/invalid JSON/);
  });

  it('rejects JSON without a trailing newline', () => {
    expect(() => selfLint([ok({ path: 'x.clauflow.json', content: '{"a":1}' })])).toThrow(/trailing newline/);
  });

  it('SelfLintError carries the file path and prefixed message', () => {
    try {
      selfLint([ok({ path: 'deep/settings.clauflow.json', content: 'nope' })]);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SelfLintError);
      expect((err as SelfLintError).file).toBe('deep/settings.clauflow.json');
      expect((err as Error).message).toMatch(/^self-lint failed for deep\/settings\.clauflow\.json:/);
    }
  });
});

describe('selfLint workflow script', () => {
  it('accepts a well-formed script', () => {
    expect(() => selfLint([ok({ path: '.claude/workflows/x.js', content: validScript })])).not.toThrow();
  });

  it('rejects invalid JavaScript', () => {
    const bad = 'export const meta = { name: "t" }\nconst a = await agent(`x`\nreturn a\n';
    expect(() => selfLint([ok({ path: '.claude/workflows/x.js', content: bad })])).toThrow(/invalid JavaScript/);
  });

  it('requires an `export const meta`', () => {
    const bad = 'const a = await agent(`x`)\nreturn a\n';
    expect(() => selfLint([ok({ path: '.claude/workflows/x.js', content: bad })])).toThrow(/export const meta/);
  });

  it('requires exactly one top-level return', () => {
    const bad = 'export const meta = { name: "t" }\nconst a = await agent(`x`)\n';
    expect(() => selfLint([ok({ path: '.claude/workflows/x.js', content: bad })])).toThrow(/exactly one top-level return/);
  });

  it('requires the return to be the last statement', () => {
    const bad = [
      'export const meta = { name: "t" }',
      'return 1',
      'const a = await agent(`x`)',
      '',
    ].join('\n');
    expect(() => selfLint([ok({ path: '.claude/workflows/x.js', content: bad })])).toThrow(/not the last statement/);
  });

  it('rejects a reference to an undefined identifier', () => {
    const bad = [
      'export const meta = { name: "t" }',
      'const a = await agent(`x`)',
      'return somethingUndeclared',
      '',
    ].join('\n');
    expect(() => selfLint([ok({ path: '.claude/workflows/x.js', content: bad })])).toThrow(/undefined identifier/);
  });

  it('allows the workflow runtime globals + JS built-ins', () => {
    const src = [
      'export const meta = { name: "t", description: "d" }',
      'const items = await pipeline(args, item => agent(`Do ${item}.`))',
      'return items.filter(Boolean)',
      '',
    ].join('\n');
    expect(() => selfLint([ok({ path: '.claude/workflows/x.js', content: src })])).not.toThrow();
  });

  it('rejects a script without a trailing newline', () => {
    const bad = validScript.trimEnd();
    expect(() => selfLint([ok({ path: '.claude/workflows/x.js', content: bad })])).toThrow(/trailing newline/);
  });
});
