// Problems panel — one row per diagnostic, same Diagnostic object rendered as a
// node badge / field underline / this row (DESIGN-BRIEF "validation is ambient").
// Quick fix is always a button; warnings get an Ack checkbox with the rule id.
import { useEditor } from '../useEditor.js';
import type { EditorStore } from '../store.js';
import { SEVERITY_COLOR, SEVERITY_ICON, TOKENS, SPACE } from '../tokens.js';
import type { Diagnostic } from '@clauflow/core';

export function ProblemsPanel({ store }: { store: EditorStore }) {
  useEditor(store); // re-render on change
  const diags = store.diagnostics();
  const acked = new Set(store.current.meta.ackedWarnings ?? []);

  return (
    <section aria-label="Problems" style={{ fontFamily: TOKENS.uiFont, color: TOKENS.text }}>
      <header style={{ padding: SPACE(2), borderBottom: `1px solid ${TOKENS.border}`, fontWeight: 600 }}>
        Problems {diags.length > 0 && <span aria-label="count">({diags.length})</span>}
      </header>
      {diags.length === 0 ? (
        <p style={{ padding: SPACE(2), color: TOKENS.textMuted }}>No problems — ready to export.</p>
      ) : (
        <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {diags.map((d, i) => (
            <ProblemRow key={`${d.ruleId}-${d.nodeId ?? 'graph'}-${i}`} store={store} d={d} acked={acked.has(d.ruleId)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProblemRow({ store, d, acked }: { store: EditorStore; d: Diagnostic; acked: boolean }) {
  return (
    <li
      style={{ display: 'flex', gap: SPACE(2), alignItems: 'flex-start', padding: SPACE(2), borderBottom: `1px solid ${TOKENS.border}` }}
    >
      <span aria-hidden style={{ color: SEVERITY_COLOR[d.severity] }}>{SEVERITY_ICON[d.severity]}</span>
      <div style={{ flex: 1 }}>
        <button
          type="button"
          onClick={() => d.nodeId && store.select(d.nodeId)}
          style={{ background: 'none', border: 'none', color: TOKENS.text, textAlign: 'left', padding: 0, cursor: d.nodeId ? 'pointer' : 'default' }}
        >
          {d.message}
        </button>
        <div style={{ fontFamily: TOKENS.monoFont, fontSize: '0.85em', color: TOKENS.textMuted }}>
          {d.ruleId}
          {d.nodeId ? ` · ${d.nodeId}${d.field ? `.${d.field}` : ''}` : ''}
        </div>
      </div>
      {d.quickFix && (
        <button
          type="button"
          onClick={() => store.applyQuickFix(d.quickFix!)}
          style={{ fontFamily: TOKENS.uiFont, borderRadius: '2px', border: `1px solid ${TOKENS.border}`, background: TOKENS.surfaceRaised, color: TOKENS.text, cursor: 'pointer', padding: `${SPACE(1)} ${SPACE(2)}` }}
        >
          {d.quickFix.title}
        </button>
      )}
      {d.severity === 'warn' && (
        <label style={{ fontSize: '0.85em', color: TOKENS.textMuted, display: 'flex', gap: SPACE(1), alignItems: 'center' }}>
          <input type="checkbox" checked={acked} onChange={() => store.toggleAck(d.ruleId)} aria-label={`Acknowledge ${d.ruleId}`} />
          Ack
        </label>
      )}
    </li>
  );
}
