import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { saveSession, loadSession, clearSession } from '../src/persistence.js';
import { TEMPLATES } from '@clauflow/core';

// Fresh IndexedDB per test.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('IndexedDB session persistence', () => {
  it('returns null when nothing is saved', async () => {
    expect(await loadSession()).toBeNull();
  });

  it('saves and loads a graph deep-equal', async () => {
    const g = TEMPLATES[0]!.graph;
    await saveSession(g);
    expect(await loadSession()).toEqual(g);
  });

  it('overwrites the previous session on re-save', async () => {
    await saveSession(TEMPLATES[0]!.graph);
    await saveSession(TEMPLATES[1]!.graph);
    expect(await loadSession()).toEqual(TEMPLATES[1]!.graph);
  });

  it('clearSession drops the saved graph', async () => {
    await saveSession(TEMPLATES[0]!.graph);
    await clearSession();
    expect(await loadSession()).toBeNull();
  });

  it('returns null for a stored value that fails schema validation', async () => {
    // Write a bogus value directly under the same key, then load.
    await saveSession(TEMPLATES[0]!.graph);
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('clauflow', 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise<void>((res, rej) => {
      const r = db.transaction('session', 'readwrite').objectStore('session').put({ version: 999 }, 'last-graph');
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
    db.close();
    expect(await loadSession()).toBeNull();
  });
});
