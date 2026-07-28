import { describe, it, expect } from 'vitest';
import {
  planExport, changesToWrite, collectWorkspaceAssets, detectAssets, isImportable, runnerCommand,
  type FsAccess,
} from '../src/host-fs.js';
import { generate, TEMPLATES } from '@clauflow/core';
import type { GeneratedFile } from '@clauflow/core';

/** In-memory FsAccess over a flat path→content map. */
function fakeFs(initial: Record<string, string> = {}): FsAccess & { store: Map<string, string> } {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async read(p) { return store.has(p) ? store.get(p)! : null; },
    async write(p, c) { store.set(p, c); },
    async list(dir) {
      const prefix = dir === '.' ? '' : dir.replace(/\/?$/, '/');
      return [...store.keys()].filter((k) => (dir === '.' ? true : k.startsWith(prefix)));
    },
  };
}

describe('planExport', () => {
  it('classifies create / modify / unchanged against disk', async () => {
    const files: GeneratedFile[] = [
      { path: '.claude/a.json', content: 'new\n' },
      { path: '.claude/b.json', content: 'v2\n' },
      { path: '.claude/c.json', content: 'same\n' },
    ];
    const fs = fakeFs({ '.claude/b.json': 'v1\n', '.claude/c.json': 'same\n' });
    const plan = await planExport(files, fs);
    expect(plan.find((c) => c.path === '.claude/a.json')!.kind).toBe('create');
    const b = plan.find((c) => c.path === '.claude/b.json')!;
    expect(b.kind).toBe('modify');
    if (b.kind === 'modify') expect(b.previous).toBe('v1\n');
    expect(plan.find((c) => c.path === '.claude/c.json')!.kind).toBe('unchanged');
  });

  it('changesToWrite drops unchanged files', async () => {
    const fs = fakeFs({ '.claude/c.json': 'same\n' });
    const plan = await planExport(
      [{ path: '.claude/c.json', content: 'same\n' }, { path: '.claude/a.json', content: 'x\n' }],
      fs,
    );
    expect(changesToWrite(plan).map((c) => c.path)).toEqual(['.claude/a.json']);
  });

  it('refuses an unsafe path (shared core guard)', async () => {
    await expect(planExport([{ path: '.claude/../../escape', content: 'x' }], fakeFs())).rejects.toThrow(/unsafe/);
  });
});

describe('collectWorkspaceAssets', () => {
  it('reads back a written template export into importable files', async () => {
    const t = TEMPLATES.find((x) => x.slug === 'security-gate')!;
    const fs = fakeFs();
    for (const f of generate(t.graph)) await fs.write(f.path, f.content);
    // add noise that must be ignored
    await fs.write('README.md', '# hi');
    await fs.write('.claude/hooks/pretooluse-1.sh', 'script'); // regenerated, not imported
    const assets = await collectWorkspaceAssets(fs);
    const paths = assets.map((f) => f.path).sort();
    expect(paths).toContain('.claude/settings.json');
    expect(paths).toContain('flow.clauflow.json');
    expect(paths).not.toContain('README.md');
    expect(paths).not.toContain('.claude/hooks/pretooluse-1.sh');
  });
});

describe('isImportable', () => {
  it('matches the .claude asset set, not hook scripts or arbitrary files', () => {
    expect(isImportable('.claude/skills/x/SKILL.md')).toBe(true);
    expect(isImportable('flow.clauflow.json')).toBe(true);
    expect(isImportable('.claude/hooks/x.sh')).toBe(false);
    expect(isImportable('src/index.ts')).toBe(false);
  });
});

describe('detectAssets', () => {
  it('groups workspace paths by kind for the tree view', () => {
    const d = detectAssets([
      '.claude/skills/deploy/SKILL.md',
      '.claude/commands/lint.md',
      '.claude/agents/rev.md',
      '.claude/hooks/pretooluse-1.sh',
      'flow.clauflow.json',
      'README.md',
    ]);
    expect(d.skills).toEqual(['.claude/skills/deploy/SKILL.md', '.claude/commands/lint.md']);
    expect(d.agents).toEqual(['.claude/agents/rev.md']);
    expect(d.hooks).toEqual(['.claude/hooks/pretooluse-1.sh']);
    expect(d.graphs).toEqual(['flow.clauflow.json']);
  });
});

describe('runnerCommand', () => {
  it('extracts a single-line claude invocation', () => {
    const cmd = runnerCommand([{ path: 'run.sh', content: '#!/bin/bash\nset -euo pipefail\nclaude -p \'go\' --model \'opus\'\n' }]);
    expect(cmd).toBe("claude -p 'go' --model 'opus'");
  });

  it('joins a multi-line invocation (fixes the M2 truncation carry-over)', () => {
    const runSh = "#!/bin/bash\nset -euo pipefail\nclaude -p 'line one\nline two' --verbose\n";
    const cmd = runnerCommand([{ path: 'run.sh', content: runSh }]);
    expect(cmd).toBe("claude -p 'line one\nline two' --verbose");
  });

  it('handles a prompt with an escaped apostrophe and leaves no trailing newline', () => {
    // shSingleQuote escapes an apostrophe as '\'' → an odd count of quote chars,
    // which the old balance heuristic mis-read. The command must be a single line
    // with no trailing newline (a trailing \n would auto-run in the terminal).
    const runSh = "#!/bin/bash\nset -euo pipefail\nclaude -p 'fix the app'\\''s tests'\n";
    const cmd = runnerCommand([{ path: 'run.sh', content: runSh }]);
    expect(cmd).toBe("claude -p 'fix the app'\\''s tests'");
    expect(cmd!.endsWith('\n')).toBe(false);
  });

  it('returns null when there is no run.sh', () => {
    expect(runnerCommand([{ path: 'x.md', content: 'hi' }])).toBeNull();
  });

  it('extracts the real generated test-fix-loop runner', () => {
    const files = generate(TEMPLATES.find((t) => t.slug === 'test-fix-loop')!.graph);
    const cmd = runnerCommand(files);
    expect(cmd).toMatch(/^claude -p /);
    expect(cmd).toContain('--max-turns 40');
  });
});
