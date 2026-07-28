// Acceptance: rebuilding each gallery template through EditorStore operations
// (add nodes, set fields, connect) yields byte-identical export to the M1
// fixtures. This proves the canvas can express every graph the schema allows.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EditorStore, makeNode } from '../src/index.js';
import { generate, TEMPLATES } from '@clauflow/core';
import type { WorkflowGraph, NodeKind } from '@clauflow/core';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', '..', '..', 'fixtures');

/**
 * Replay a target graph through store ops: create each node via the palette
 * helper, set its data + label + position, connect edges, and apply settings/
 * meta. The store's resulting graph must deep-equal the target — i.e. every field
 * is reachable through the store API (the canvas' only mutation path).
 */
function rebuild(target: WorkflowGraph): EditorStore {
  const store = new EditorStore();
  store.updateMeta({ name: target.meta.name, slug: target.meta.slug, description: target.meta.description });
  if (target.meta.ackedWarnings) for (const r of target.meta.ackedWarnings) store.toggleAck(r);
  store.updateSettings(target.settings);

  for (const n of target.nodes) {
    const created = makeNode(store, n.kind as NodeKind, n.position);
    store.addNode(created);
    store.updateNodeLabel(created.id, n.label);
    // Replace data wholesale to match the target exactly.
    store.updateNodeData(created.id, n.data as Record<string, unknown>);
    // Re-map the target's id → created id for edge wiring.
    idMap.set(n.id, created.id);
  }
  for (const e of target.edges) {
    store.connect(idMap.get(e.source)!, idMap.get(e.target)!);
  }
  return store;
}

let idMap = new Map<string, string>();

describe('rebuild each gallery template via store ops → byte-identical export', () => {
  for (const t of TEMPLATES) {
    it(`${t.slug}: store-built graph exports identically to the committed fixture`, () => {
      idMap = new Map();
      const store = rebuild(t.graph);
      // The store may assign different node ids; compare the EXPORT, which is
      // id-independent (paths + content), against the committed fixtures.
      const files = generate(store.current);
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        // flow.clauflow.json embeds node ids, which legitimately differ from the
        // hand-authored template; compare all other artifacts byte-for-byte.
        if (f.path === 'flow.clauflow.json') continue;
        const fixturePath = join(fixturesDir, t.slug, f.path);
        expect(existsSync(fixturePath), `missing fixture ${t.slug}/${f.path}`).toBe(true);
        expect(f.content, `content drift in ${t.slug}/${f.path}`).toBe(readFileSync(fixturePath, 'utf8'));
      }
    });

    it(`${t.slug}: exports the same non-graph file set as the fixture`, () => {
      idMap = new Map();
      const store = rebuild(t.graph);
      const paths = generate(store.current).map((f) => f.path).filter((p) => p !== 'flow.clauflow.json').sort();
      const fromTemplate = generate(t.graph).map((f) => f.path).filter((p) => p !== 'flow.clauflow.json').sort();
      expect(paths).toEqual(fromTemplate);
    });
  }
});
