// Standalone web app shell. Landing = template gallery + import + resume; once a
// graph is chosen it mounts the shared Designer wired to the WebHostBridge.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Designer, EditorStore } from '@clauflow/canvas';
import { TEMPLATES } from '@clauflow/core';
import type { WorkflowGraph } from '@clauflow/core';
import { WebHostBridge } from './hostBridge.js';
import { saveSession, loadSession, clearSession } from './persistence.js';

type Toast = { level: 'info' | 'warn' | 'error'; msg: string } | null;

export function App() {
  const [store, setStore] = useState<EditorStore | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [hasSaved, setHasSaved] = useState(false);

  const host = useMemo(
    () =>
      new WebHostBridge({
        notify: (level, msg) => setToast({ level, msg }),
        openFile: () => {},
      }),
    [],
  );

  // Offer to resume the last session if one exists.
  useEffect(() => {
    void loadSession().then((g) => setHasSaved(g !== null));
  }, []);

  // Autosave the active graph (debounced) so a reload can restore it.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!store) return;
    const unsub = store.subscribe(() => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void saveSession(store.current), 500);
    });
    return () => {
      unsub();
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [store]);

  const open = (graph: WorkflowGraph) => setStore(new EditorStore(graph));

  const resume = async () => {
    const g = await loadSession();
    if (g) open(g);
    else setToast({ level: 'warn', msg: 'No saved session to resume.' });
  };

  const importDir = async () => {
    const g = await host.readProject();
    if (g) open(g);
  };

  if (!store) {
    return (
      <Landing
        onOpenTemplate={open}
        onImport={importDir}
        onResume={resume}
        hasSaved={hasSaved}
        onClearData={async () => {
          await clearSession();
          setHasSaved(false);
          setToast({ level: 'info', msg: 'Saved session cleared.' });
        }}
        toast={toast}
      />
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, borderBottom: '1px solid var(--vscode-editorWidget-border,#3c3c3c)', alignItems: 'center' }}>
        <button type="button" onClick={() => setStore(null)}>← Gallery</button>
        <span style={{ flex: 1 }} />
        {toast && <span role="status" style={{ opacity: 0.8 }}>{toast.msg}</span>}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Designer store={store} host={host} />
      </div>
    </div>
  );
}

function Landing({
  onOpenTemplate, onImport, onResume, onClearData, hasSaved, toast,
}: {
  onOpenTemplate: (g: WorkflowGraph) => void;
  onImport: () => void;
  onResume: () => void;
  onClearData: () => void;
  hasSaved: boolean;
  toast: Toast;
}) {
  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Claude Flow Designer</h1>
      <p>Design a Claude Code workflow, then export a ready-to-use <code>.claude/</code> folder.</p>

      <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
        <button type="button" onClick={() => onOpenTemplate(blankGraph())}>New blank workflow</button>
        <button type="button" onClick={onImport}>Import a project folder…</button>
        {hasSaved && <button type="button" onClick={onResume}>Resume last session</button>}
        {hasSaved && <button type="button" onClick={onClearData}>Clear saved data</button>}
      </div>

      <h2>Templates</h2>
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {TEMPLATES.map((t) => (
          <li key={t.slug} style={{ border: '1px solid #3c3c3c', borderRadius: 6, padding: 12 }}>
            <button type="button" onClick={() => onOpenTemplate(t.graph)} style={{ textAlign: 'left', width: '100%', background: 'none', border: 'none', cursor: 'pointer' }}>
              <strong>{t.title}</strong>
              <div style={{ opacity: 0.7, fontSize: '0.9em' }}>{t.graph.meta.description}</div>
            </button>
          </li>
        ))}
      </ul>
      {toast && <p role="status">{toast.msg}</p>}
    </main>
  );
}

function blankGraph(): WorkflowGraph {
  return {
    version: 1,
    meta: { name: 'Untitled workflow', slug: 'untitled' },
    settings: {},
    nodes: [],
    edges: [],
  };
}
