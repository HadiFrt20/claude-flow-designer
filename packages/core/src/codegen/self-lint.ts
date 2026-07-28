// Self-lint: parse every emitted artifact and assert structural invariants.
// A failure here is a codegen BUG — generate() throws rather than silently ship.
// (SPEC-CODEGEN "self-lint"; SPEC-REVIEW Loop B.)
import yaml from 'js-yaml';
import type { GeneratedFile } from '../schema/types.js';
import { isSafePath } from './paths.js';

export class SelfLintError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(`self-lint failed for ${file}: ${message}`);
    this.name = 'SelfLintError';
  }
}

function lintJson(file: GeneratedFile): void {
  try {
    JSON.parse(file.content);
  } catch (err) {
    throw new SelfLintError(`invalid JSON (${(err as Error).message})`, file.path);
  }
  if (!file.content.endsWith('\n')) throw new SelfLintError('missing trailing newline', file.path);
}

function lintFrontmatter(file: GeneratedFile): void {
  const m = /^---\n([\s\S]*?)\n---/.exec(file.content);
  if (!m) throw new SelfLintError('missing YAML frontmatter block', file.path);
  try {
    const parsed = yaml.load(m[1]!);
    if (parsed === null || typeof parsed !== 'object') {
      throw new SelfLintError('frontmatter is not a mapping', file.path);
    }
  } catch (err) {
    if (err instanceof SelfLintError) throw err;
    throw new SelfLintError(`invalid YAML frontmatter (${(err as Error).message})`, file.path);
  }
}

function lintScript(file: GeneratedFile): void {
  const c = file.content;
  if (!c.startsWith('#!/bin/bash')) throw new SelfLintError('missing #!/bin/bash shebang', file.path);
  if (!c.endsWith('\n')) throw new SelfLintError('missing trailing newline', file.path);
  if (!file.executable) throw new SelfLintError('script not marked executable', file.path);

  // The jq-guard + stdin-read invariant applies only to generated HOOK scripts
  // (…/hooks/*.sh, in both .claude/ and plugin-bundle layouts), which receive the
  // hook payload on stdin. The headless runner (run.sh) is not a hook and
  // legitimately has neither (CF115 scope).
  const isHookScript = /\/hooks\/[^/]+\.sh$/.test(file.path);
  if (isHookScript) {
    if (!/command -v jq >\/dev\/null/.test(c)) {
      throw new SelfLintError('hook script missing jq availability guard', file.path);
    }
    if (!/input=\$\(cat\)/.test(c)) {
      throw new SelfLintError('hook script missing stdin read (input=$(cat))', file.path);
    }
  }
}

/** Lint every generated file by type. Throws SelfLintError on the first problem. */
export function selfLint(files: GeneratedFile[]): void {
  for (const file of files) {
    // Containment first: no emitted path may escape the target directory. This is
    // the single guard every host relies on (web dir-write/zip, VS Code workspace).
    if (!isSafePath(file.path)) {
      throw new SelfLintError('unsafe path — escapes the target directory', file.path);
    }
    if (file.path.endsWith('.json')) lintJson(file);
    else if (file.path.endsWith('.sh')) lintScript(file);
    else if (file.path.endsWith('.md')) lintFrontmatter(file);
  }
}
