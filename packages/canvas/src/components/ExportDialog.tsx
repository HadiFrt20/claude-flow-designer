// Export dialog = the review moment (DESIGN-BRIEF). Shows the file tree, acked
// warnings with rule ids, and the exact `claude` command the runner will execute.
// The primary action reads "Write N files", never "OK". Actual writing is the
// host's job (HostBridge); this component only assembles + confirms.
import { useEditor } from '../useEditor.js';
import type { EditorStore } from '../store.js';
import type { HostBridge } from '../hostBridge.js';
import { previewOf } from './PreviewPane.js';
import { TOKENS, SPACE, SEVERITY_COLOR, SEVERITY_ICON } from '../tokens.js';

/** Extract the exact `claude …` invocation from a generated run.sh, if present. */
export function runnerCommand(files: { path: string; content: string }[]): string | null {
  const run = files.find((f) => f.path === 'run.sh');
  if (!run) return null;
  return run.content.split('\n').find((l) => l.startsWith('claude ')) ?? null;
}

export function ExportDialog({ store, host, onClose }: { store: EditorStore; host: HostBridge; onClose: () => void }) {
  useEditor(store);
  const result = previewOf(store);
  const acked = store.current.meta.ackedWarnings ?? [];

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
  const cmd = runnerCommand(files);

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
      {cmd && (
        <div style={{ marginBottom: SPACE(2) }}>
          <div style={{ fontSize: '0.8em', color: TOKENS.textMuted }}>Runner command:</div>
          <code style={{ fontFamily: TOKENS.monoFont, fontSize: '0.85em' }}>{cmd}</code>
        </div>
      )}
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
