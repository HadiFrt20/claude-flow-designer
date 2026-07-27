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

  it('rejects invalid JSON', () => {
    expect(() => selfLint([ok({ path: 'x/settings.json', content: '{bad}\n' })])).toThrow(SelfLintError);
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
});
