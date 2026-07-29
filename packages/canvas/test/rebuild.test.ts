// Acceptance: rebuilding each gallery template through EditorStore operations
// (add nodes, set fields, connect) yields byte-identical export to the committed
// fixtures. This proves the canvas can express every graph the schema allows.
//
// M6 note: resultRefs and {{template refs}} are NODE IDS, so a faithful rebuild
// preserves each node's id (the same invariant the sidecar round-trip relies on).
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EditorStore } from '../src/index.js';
import { generate, TEMPLATES } from '@clauflow/core';
import type { WorkflowGraph } from '@clauflow/core';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', '..', '..', 'fixtures');

const isSidecar = (path: string) => path.endsWith('.clauflow.json');

/**
 * Replay a target graph through store ops: add each node (preserving its id, data,
 * label, position), then connect edges. The store's resulting graph must export
 * identically to the committed fixture — i.e. every field is reachable through
 * the store API (the canvas' only mutation path).
 */
function rebuild(target: WorkflowGraph): EditorStore {
  const store = new EditorStore();
  store.updateMeta({ name: target.meta.name, slug: target.meta.slug, description: target.meta.description });
  if (target.meta.ackedWarnings) for (const r of target.meta.ackedWarnings) store.toggleAck(r);
  store.updateSettings(target.settings);

  for (const n of target.nodes) {
    // Preserve the node id: refs point at it (resultRef / {{id}} template refs).
    store.addNode({ ...n });
    store.updateNodeLabel(n.id, n.label);
    store.updateNodeData(n.id, n.data as Record<string, unknown>);
  }
  for (const e of target.edges) {
    store.connect(e.source, e.target, e.sourceHandle);
  }
  return store;
}

describe('rebuild each gallery template via store ops → byte-identical export', () => {
  for (const t of TEMPLATES) {
    it(`${t.slug}: store-built graph exports identically to the committed fixture`, () => {
      const store = rebuild(t.graph);
      const files = generate(store.current);
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        // The sidecar embeds ids/positions; the emitted .js is the artifact that
        // must match byte-for-byte. (Ids are preserved here, so the sidecar also
        // matches, but positions could differ in general — compare the .js.)
        if (isSidecar(f.path)) continue;
        const fixturePath = join(fixturesDir, t.slug, f.path);
        expect(existsSync(fixturePath), `missing fixture ${t.slug}/${f.path}`).toBe(true);
        expect(f.content, `content drift in ${t.slug}/${f.path}`).toBe(readFileSync(fixturePath, 'utf8'));
      }
    });

    it(`${t.slug}: exports the same file set as the template`, () => {
      const store = rebuild(t.graph);
      const paths = generate(store.current).map((f) => f.path).sort();
      const fromTemplate = generate(t.graph).map((f) => f.path).sort();
      expect(paths).toEqual(fromTemplate);
    });
  }
});
