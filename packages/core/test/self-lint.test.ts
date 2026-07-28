import { describe, it, expect } from 'vitest';
import { selfLint, SelfLintError } from '../src/codegen/self-lint.js';
import type { GeneratedFile } from '../src/schema/types.js';

const ok = (over: Partial<GeneratedFile> & { path: string }): GeneratedFile => ({
  content: '',
  ...over,
});

describe('selfLint', () => {
  it('accepts a valid JSON file', () => {
    expect(() => selfLint([ok({ path: 'x/settings.json', content: '{"a":1}\n' })])).not.toThrow();
  });

  it('rejects invalid JSON with a descriptive message', () => {
    expect(() => selfLint([ok({ path: 'x/settings.json', content: '{bad}\n' })])).toThrow(/invalid JSON/);
  });

  it('rejects frontmatter that parses to a non-mapping', () => {
    // A YAML scalar (not an object) — exercises the "not a mapping" branch.
    expect(() => selfLint([ok({ path: 'x/SKILL.md', content: '---\njust a string\n---\n\nbody\n' })])).toThrow(
      /not a mapping/,
    );
  });

  it('reports invalid YAML frontmatter distinctly from a missing block', () => {
    expect(() =>
      selfLint([ok({ path: 'x/SKILL.md', content: '---\nkey: "unterminated\n---\n\nbody\n' })]),
    ).toThrow(/invalid YAML frontmatter/);
  });

  it('SelfLintError carries the file path and prefixed message', () => {
    try {
      selfLint([ok({ path: 'deep/settings.json', content: 'nope' })]);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SelfLintError);
      expect((err as SelfLintError).file).toBe('deep/settings.json');
      expect((err as Error).message).toMatch(/^self-lint failed for deep\/settings\.json:/);
    }
  });

  it('rejects JSON without a trailing newline', () => {
    expect(() => selfLint([ok({ path: 'x/settings.json', content: '{"a":1}' })])).toThrow(/trailing newline/);
  });

  it('accepts a valid markdown frontmatter file', () => {
    expect(() =>
      selfLint([ok({ path: 'x/SKILL.md', content: '---\ndescription: hi\n---\n\nbody\n' })]),
    ).not.toThrow();
  });

  it('rejects markdown without frontmatter', () => {
    expect(() => selfLint([ok({ path: 'x/SKILL.md', content: 'no frontmatter\n' })])).toThrow(/frontmatter/);
  });

  it('requires the jq guard + stdin read on a hook script', () => {
    const bad = ok({ path: '.claude/hooks/x.sh', content: '#!/bin/bash\necho hi\n', executable: true });
    expect(() => selfLint([bad])).toThrow(/jq availability guard/);
  });

  it('requires hook scripts to be executable', () => {
    const bad = ok({
      path: '.claude/hooks/x.sh',
      content: '#!/bin/bash\ncommand -v jq >/dev/null || exit 1\ninput=$(cat)\n',
      executable: false,
    });
    expect(() => selfLint([bad])).toThrow(/executable/);
  });

  it('does NOT require jq guard on run.sh (not a hook script)', () => {
    const run = ok({ path: 'run.sh', content: '#!/bin/bash\nset -euo pipefail\nclaude -p go\n', executable: true });
    expect(() => selfLint([run])).not.toThrow();
  });

  it('requires a shebang on scripts', () => {
    const bad = ok({ path: 'run.sh', content: 'claude -p go\n', executable: true });
    expect(() => selfLint([bad])).toThrow(/shebang/);
  });

  it('reports the hook stdin-read requirement distinctly from the jq guard', () => {
    const bad = ok({
      path: '.claude/hooks/x.sh',
      content: '#!/bin/bash\ncommand -v jq >/dev/null || exit 1\necho hi\n',
      executable: true,
    });
    expect(() => selfLint([bad])).toThrow(/stdin read/);
  });

  it('rejects JSON trailing-newline with the specific message', () => {
    expect(() => selfLint([ok({ path: 'x/settings.json', content: '{}' })])).toThrow(/trailing newline/);
  });

  it('re-throws a nested SelfLintError unchanged (does not wrap twice)', () => {
    // A markdown file with malformed frontmatter: the inner catch must rethrow the
    // SelfLintError (the "err instanceof SelfLintError" branch), not wrap it.
    try {
      selfLint([ok({ path: 'x/SKILL.md', content: '---\n123\n---\n\nbody\n' })]);
    } catch (err) {
      expect((err as Error).message).not.toMatch(/self-lint failed.*self-lint failed/);
    }
  });
});
