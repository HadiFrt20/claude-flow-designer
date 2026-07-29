// Export dialog = the review moment (DESIGN-BRIEF). Shows the file tree, acked
// warnings with rule ids, and the slash command that runs the exported workflow.
// The primary action reads "Write N files", never "OK". Actual writing is the
// host's job (HostBridge); this component only assembles + confirms.
import { useEditor } from '../useEditor.js';
import type { EditorStore } from '../store.js';
import type { HostBridge } from '../hostBridge.js';
import type { WorkflowGraph } from '@clauflow/core';
import { previewOf } from './PreviewPane.js';
import { TOKENS, SPACE, SEVERITY_COLOR, SEVERITY_ICON } from '../tokens.js';

/** The `/command` that runs the exported workflow: meta.name if set, else the slug. */
export function workflowInvocation(graph: WorkflowGraph): string {
  const meta = graph.nodes.find((n) => n.kind === 'workflow.meta');
  const name = meta?.kind === 'workflow.meta' ? meta.data.name : graph.meta.slug;
  return `/${name}`;
}

export function ExportDialog({ store, host, onClose }: { store: EditorStore; host: HostBridge; onClose: () => void }) {
  useEditor(store);
  const result = previewOf(store);
  const acked = store.current.meta.ackedWarnings ?? [];

  if (!result.ok && 'error' in result) {
    return (
      <Modal title="Cannot export yet" onClose={onClose}>
        <p style={{ color: TOKENS.error }}>Codegen error: {result.error}</p>
      </Modal>
    );
  }
  if (!result.ok) {
    return (
      <Modal title="Cannot export yet" onClose={onClose}>
        <p style={{ color: TOKENS.textMuted }}>Resolve the blocking problems first:</p>
        <ul>
          {result.blocking.map((d, i) => (
            <li key={i} style={{ color: SEVERITY_COLOR[d.severity] }}>
              <span aria-hidden>{SEVERITY_ICON[d.severity]}</span> {d.message} ({d.ruleId})
            </li>
          ))}
        </ul>
      </Modal>
    );
  }

  const { files } = result;
  const invocation = workflowInvocation(store.current);

  const write = () => {
    void host.writeFiles(files, { dryRun: false });
    onClose();
  };

  return (
    <Modal title="Review export" onClose={onClose}>
      <div style={{ fontFamily: TOKENS.monoFont, fontSize: '0.85em', marginBottom: SPACE(2) }}>
        {files.map((f) => (
          <div key={f.path}>{f.executable ? 'x ' : '  '}{f.path}</div>
        ))}
      </div>
      {acked.length > 0 && (
        <p style={{ color: TOKENS.warn, fontSize: '0.85em' }}>
          Acknowledged warnings: {acked.join(', ')}
        </p>
      )}
      <div style={{ marginBottom: SPACE(2) }}>
        <div style={{ fontSize: '0.8em', color: TOKENS.textMuted }}>Run it with:</div>
        <code style={{ fontFamily: TOKENS.monoFont, fontSize: '0.85em' }}>{invocation}</code>
      </div>
      <button
        type="button"
        onClick={write}
        style={{ padding: `${SPACE(1)} ${SPACE(3)}`, borderRadius: '2px', border: 'none', background: TOKENS.focusRing, color: '#fff', cursor: 'pointer', fontFamily: TOKENS.uiFont }}
      >
        Write {files.length} file{files.length === 1 ? '' : 's'}
      </button>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: TOKENS.surfaceRaised, color: TOKENS.text, fontFamily: TOKENS.uiFont, borderRadius: '4px', border: `1px solid ${TOKENS.border}`, padding: SPACE(4), minWidth: 420, maxWidth: '80vw', maxHeight: '80vh', overflow: 'auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: SPACE(2) }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: TOKENS.text, cursor: 'pointer', fontSize: '1.2em' }}>×</button>
        </header>
        {children}
      </div>
    </div>
  );
}
