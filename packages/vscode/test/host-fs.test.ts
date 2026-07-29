import { describe, it, expect } from 'vitest';
import {
  planExport, changesToWrite, collectWorkspaceAssets, detectAssets, isImportable,
  type FsAccess,
} from '../src/host-fs.js';
import { generate, parseProject, TEMPLATES } from '@clauflow/core';
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
  it('reads back a written template export into importable sidecars only', async () => {
    const t = TEMPLATES.find((x) => x.slug === 'audit-routes')!;
    const fs = fakeFs();
    for (const f of generate(t.graph)) await fs.write(f.path, f.content);
    // add noise that must be ignored
    await fs.write('README.md', '# hi');
    const assets = await collectWorkspaceAssets(fs);
    const paths = assets.map((f) => f.path).sort();
    expect(paths).toContain('audit-routes.clauflow.json');
    // The emitted .js is one-way output — never imported.
    expect(paths).not.toContain('.claude/workflows/audit-routes.js');
    expect(paths).not.toContain('README.md');
  });

  it('round-trips a written export back to the graph via the sidecar', async () => {
    const t = TEMPLATES[0]!;
    const fs = fakeFs();
    for (const f of generate(t.graph)) await fs.write(f.path, f.content);
    const graph = parseProject(await collectWorkspaceAssets(fs));
    expect(graph).toEqual(t.graph);
  });
});

describe('isImportable', () => {
  it('matches the .clauflow.json sidecar, not the emitted .js or arbitrary files', () => {
    expect(isImportable('audit-routes.clauflow.json')).toBe(true);
    expect(isImportable('.claude/workflows/audit-routes.js')).toBe(false);
    expect(isImportable('src/index.ts')).toBe(false);
  });
});

describe('detectAssets', () => {
  it('groups workspace paths into workflows + graphs for the tree view', () => {
    const d = detectAssets([
      '.claude/workflows/audit-routes.js',
      '.claude/workflows/summarize.js',
      'audit-routes.clauflow.json',
      'README.md',
    ]);
    expect(d.workflows).toEqual(['.claude/workflows/audit-routes.js', '.claude/workflows/summarize.js']);
    expect(d.graphs).toEqual(['audit-routes.clauflow.json']);
  });
});
