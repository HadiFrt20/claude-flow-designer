// Top-level canvas shell: palette | canvas + preview | (settings/properties +
// problems). Wires keyboard shortcuts (undo/redo/copy/paste/delete) with
// reduced-motion respected by the CSS the host supplies. Host-agnostic: receives
// an EditorStore and a HostBridge.
import { useEffect, useState } from 'react';
import '@xyflow/react/dist/style.css';
import type { EditorStore } from '../store.js';
import type { HostBridge } from '../hostBridge.js';
import { useEditor } from '../useEditor.js';
import { Palette } from './Palette.js';
import { FlowCanvas } from './FlowCanvas.js';
import { PropertyPanel } from './PropertyPanel.js';
import { SettingsPanel } from './SettingsPanel.js';
import { ProblemsPanel } from './ProblemsPanel.js';
import { PreviewPane } from './PreviewPane.js';
import { ExportDialog } from './ExportDialog.js';
import { TOKENS, SPACE } from '../tokens.js';

export function Designer({ store, host }: { store: EditorStore; host: HostBridge }) {
  const state = useEditor(store);
  const [showExport, setShowExport] = useState(false);

  // Keyboard shortcuts. Ignore when focus is in a text field so typing is safe.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
      else if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); store.redo(); }
      else if (mod && e.key === 'c' && !typing) { store.copy(); }
      else if (mod && e.key === 'v' && !typing) { store.paste(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && state.selectedNodeId) {
        e.preventDefault();
        store.deleteNode(state.selectedNodeId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, state.selectedNodeId]);

  const gate = store.gate();

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 320px', gridTemplateRows: '40px 1fr 200px', height: '100%', background: TOKENS.surface, color: TOKENS.text, fontFamily: TOKENS.uiFont }}>
      {/* toolbar */}
      <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: SPACE(2), padding: `0 ${SPACE(2)}`, borderBottom: `1px solid ${TOKENS.border}` }}>
        <strong>{state.graph.meta.name}</strong>
        <button type="button" onClick={() => store.undo()} disabled={!store.canUndo()} aria-label="Undo">Undo</button>
        <button type="button" onClick={() => store.redo()} disabled={!store.canRedo()} aria-label="Redo">Redo</button>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setShowExport(true)} disabled={!gate.ok} aria-label="Export">
          Export{gate.ok ? '' : ' (blocked)'}
        </button>
      </div>

      {/* left: palette */}
      <div style={{ gridRow: '2 / 4', overflow: 'hidden' }}><Palette store={store} /></div>

      {/* center: canvas */}
      <div style={{ gridRow: 2, overflow: 'hidden' }}><FlowCanvas store={store} /></div>

      {/* right: settings + properties */}
      <div style={{ gridRow: '2 / 3', overflowY: 'auto', borderLeft: `1px solid ${TOKENS.border}` }}>
        {state.selectedNodeId ? <PropertyPanel store={store} /> : <SettingsPanel store={store} />}
      </div>

      {/* bottom-center: preview */}
      <div style={{ gridRow: 3, gridColumn: 2, overflow: 'hidden', borderTop: `1px solid ${TOKENS.border}` }}>
        <PreviewPane store={store} />
      </div>

      {/* bottom-right: problems */}
      <div style={{ gridRow: 3, gridColumn: 3, overflowY: 'auto', borderTop: `1px solid ${TOKENS.border}`, borderLeft: `1px solid ${TOKENS.border}` }}>
        <ProblemsPanel store={store} />
      </div>

      {showExport && <ExportDialog store={store} host={host} onClose={() => setShowExport(false)} />}
    </div>
  );
}
