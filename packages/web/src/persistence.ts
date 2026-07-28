// Session persistence in IndexedDB: save/load the last-edited graph so a reload
// restores work. Explicit (the app calls save()); clearSession() is the
// clear-data control. Uses raw IndexedDB so it tests under fake-indexeddb.
import { safeParseGraph } from '@clauflow/core';
import type { WorkflowGraph } from '@clauflow/core';

const DB_NAME = 'clauflow';
const STORE = 'session';
const KEY = 'last-graph';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const store = db.transaction(STORE, mode).objectStore(STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Persist the current graph (serialized to a plain object). */
export async function saveSession(graph: WorkflowGraph): Promise<void> {
  const db = await openDb();
  try {
    // Store a structured clone of the graph under a fixed key.
    await tx(db, 'readwrite', (s) => s.put(structuredClone(graph), KEY));
  } finally {
    db.close();
  }
}

/**
 * Load the last session graph, re-validated against the schema. Returns null when
 * there is nothing saved or the stored value no longer matches the schema (e.g.
 * after a schema change) — so a stale/corrupt entry never crashes startup.
 */
export async function loadSession(): Promise<WorkflowGraph | null> {
  const db = await openDb();
  try {
    const raw = await tx<unknown>(db, 'readonly', (s) => s.get(KEY));
    if (raw === undefined) return null;
    const parsed = safeParseGraph(raw);
    return parsed.success ? parsed.data : null;
  } finally {
    db.close();
  }
}

/** Clear-data control: drop the persisted session. */
export async function clearSession(): Promise<void> {
  const db = await openDb();
  try {
    await tx(db, 'readwrite', (s) => s.delete(KEY));
  } finally {
    db.close();
  }
}
