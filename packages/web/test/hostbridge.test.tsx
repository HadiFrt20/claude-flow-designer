import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebHostBridge, supportsFileSystemAccess } from '../src/hostBridge.js';
import { generate, TEMPLATES } from '@clauflow/core';

// --- Minimal in-memory File System Access API mock -------------------------
// Models directory/file handles well enough to exercise writeToDirectory and
// the readProject walk. Files are stored flat by their full path.

class FakeWritable {
  constructor(private store: Map<string, string>, private path: string) {}
  async write(data: string) { this.store.set(this.path, (this.store.get(this.path) ?? '') + data); }
  async close() {}
}
class FakeFileHandle {
  kind = 'file' as const;
  constructor(private store: Map<string, string>, private path: string) {}
  async createWritable() { this.store.set(this.path, ''); return new FakeWritable(this.store, this.path); }
  async getFile() { return { text: async () => this.store.get(this.path) ?? '' }; }
}
class FakeDirHandle {
  kind = 'directory' as const;
  constructor(public store: Map<string, string>, public prefix = '') {}
  private child(name: string) { return this.prefix ? `${this.prefix}/${name}` : name; }
  async getDirectoryHandle(name: string) { return new FakeDirHandle(this.store, this.child(name)); }
  async getFileHandle(name: string) { return new FakeFileHandle(this.store, this.child(name)); }
  async *entries(): AsyncGenerator<[string, FakeDirHandle | FakeFileHandle]> {
    const seen = new Set<string>();
    const base = this.prefix ? `${this.prefix}/` : '';
    for (const path of this.store.keys()) {
      if (!path.startsWith(base)) continue;
      const rest = path.slice(base.length);
      const seg = rest.split('/')[0]!;
      if (seen.has(seg)) continue;
      seen.add(seg);
      const isDir = rest.includes('/');
      yield [seg, isDir ? new FakeDirHandle(this.store, base + seg) : new FakeFileHandle(this.store, base + seg)];
    }
  }
}

const ui = { notify: vi.fn(), openFile: vi.fn() };

beforeEach(() => {
  ui.notify.mockReset();
  ui.openFile.mockReset();
  delete (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  (globalThis as { window?: unknown }).window = globalThis;
});

describe('WebHostBridge.writeFiles — File System Access path', () => {
  it('writes every generated file byte-identically into the picked directory tree', async () => {
    const store = new Map<string, string>();
    (globalThis as { showDirectoryPicker: unknown }).showDirectoryPicker = async () => new FakeDirHandle(store);

    const files = generate(TEMPLATES.find((t) => t.slug === 'security-gate')!.graph);
    const bridge = new WebHostBridge(ui);
    const res = await bridge.writeFiles(files);

    expect(res.written.sort()).toEqual(files.map((f) => f.path).sort());
    expect(res.errors).toEqual([]);
    for (const f of files) expect(store.get(f.path)).toBe(f.content);
  });

  it('dryRun writes nothing and reports the paths', async () => {
    const files = generate(TEMPLATES[0]!.graph);
    const bridge = new WebHostBridge(ui);
    const res = await bridge.writeFiles(files, { dryRun: true });
    expect(res.written).toEqual(files.map((f) => f.path));
  });

  it('rejects an unsafe path as a hard error — never silently falls back to the zip', async () => {
    const store = new Map<string, string>();
    (globalThis as { showDirectoryPicker: unknown }).showDirectoryPicker = async () => new FakeDirHandle(store);
    const bridge = new WebHostBridge(ui);
    await expect(bridge.writeFiles([{ path: '.claude/../../escape', content: 'x' }])).rejects.toThrow(/unsafe/);
    expect(store.size).toBe(0); // nothing written anywhere
  });

  it('warns how to restore the exec bit after a directory write (FS API cannot chmod)', async () => {
    const store = new Map<string, string>();
    (globalThis as { showDirectoryPicker: unknown }).showDirectoryPicker = async () => new FakeDirHandle(store);
    // security-gate emits an executable hook script.
    const files = generate(TEMPLATES.find((t) => t.slug === 'security-gate')!.graph);
    await new WebHostBridge(ui).writeFiles(files);
    expect(ui.notify).toHaveBeenCalledWith('warn', expect.stringMatching(/chmod \+x/));
  });
});

describe('WebHostBridge.readProject — import round-trip', () => {
  it('reads a written .claude tree back and parses an equivalent graph', async () => {
    const store = new Map<string, string>();
    (globalThis as { showDirectoryPicker: unknown }).showDirectoryPicker = async () => new FakeDirHandle(store);

    // Seed the store with a template's export (incl. flow.clauflow.json).
    const template = TEMPLATES.find((t) => t.slug === 'pr-review')!;
    for (const f of generate(template.graph)) store.set(f.path, f.content);

    const bridge = new WebHostBridge(ui);
    const graph = await bridge.readProject();
    // flow.clauflow.json is present, so the importer round-trips exactly.
    expect(graph).toEqual(template.graph);
  });

  it('returns null when the folder has no .claude assets', async () => {
    const store = new Map<string, string>([['README.md', '# hi']]);
    (globalThis as { showDirectoryPicker: unknown }).showDirectoryPicker = async () => new FakeDirHandle(store);
    const bridge = new WebHostBridge(ui);
    expect(await bridge.readProject()).toBeNull();
    expect(ui.notify).toHaveBeenCalledWith('warn', expect.stringMatching(/No \.claude assets/));
  });
});

describe('supportsFileSystemAccess', () => {
  it('is false without showDirectoryPicker', () => {
    (globalThis as { window: unknown }).window = globalThis;
    expect(supportsFileSystemAccess()).toBe(false);
  });
  it('is true when showDirectoryPicker exists', () => {
    (globalThis as { showDirectoryPicker: unknown }).showDirectoryPicker = () => {};
    expect(supportsFileSystemAccess()).toBe(true);
  });
});
