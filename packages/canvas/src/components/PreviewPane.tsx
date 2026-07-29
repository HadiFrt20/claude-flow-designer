// Live preview pane (DESIGN-BRIEF signature element). Renders generate() output
// as an authentic editor buffer with per-file tabs. When the export gate blocks,
// it shows the blocking diagnostics instead of stale output. Generation is
// debounced so typing stays smooth.
import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '../useEditor.js';
import type { EditorStore } from '../store.js';
import { generate, ExportGateError } from '@clauflow/core';
import type { GeneratedFile } from '@clauflow/core';
import { TOKENS, SPACE, SEVERITY_COLOR, SEVERITY_ICON } from '../tokens.js';

type PreviewResult =
  | { ok: true; files: GeneratedFile[] }
  | { ok: false; blocking: ReturnType<EditorStore['diagnostics']> }
  | { ok: false; error: string };

/**
 * Pure helper (tested directly): generate, or return the blocking diagnostics,
 * or — for any other emitter error (e.g. a SelfLintError on an intermediate
 * graph) — the message. Never throws, so a mid-edit graph can't crash the
 * Designer tree.
 */
export function previewOf(store: EditorStore): PreviewResult {
  try {
    return { ok: true, files: generate(store.current) };
  } catch (err) {
    if (err instanceof ExportGateError) return { ok: false, blocking: err.blocking };
    return { ok: false, error: (err as Error).message };
  }
}

export function PreviewPane({ store, debounceMs = 150 }: { store: EditorStore; debounceMs?: number }) {
  const state = useEditor(store);
  const [tick, setTick] = useState(0);

  // Debounce: recompute a tick shortly after the graph settles.
  useEffect(() => {
    const t = setTimeout(() => setTick((n) => n + 1), debounceMs);
    return () => clearTimeout(t);
  }, [state.graph, debounceMs]);

  const result = useMemo(() => previewOf(store), [tick, store]);
  const [activePath, setActivePath] = useState<string | null>(null);

  const files = result.ok ? result.files : [];
  const active = files.find((f) => f.path === activePath) ?? files[0] ?? null;

  return (
    <section aria-label="Preview" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: TOKENS.surface, color: TOKENS.text, fontFamily: TOKENS.monoFont }}>
      {!result.ok && 'error' in result ? (
        <div style={{ padding: SPACE(3) }} role="alert">
          <p style={{ fontFamily: TOKENS.uiFont, color: TOKENS.error }}>Codegen error (unexpected):</p>
          <pre style={{ whiteSpace: 'pre-wrap', color: TOKENS.error }}>{result.error}</pre>
        </div>
      ) : !result.ok ? (
        <div style={{ padding: SPACE(3) }}>
          <p style={{ fontFamily: TOKENS.uiFont, color: TOKENS.textMuted }}>
            Export is blocked — fix these to preview generated files:
          </p>
          <ul role="list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {result.blocking.map((d, i) => (
              <li key={i} style={{ color: SEVERITY_COLOR[d.severity], display: 'flex', gap: SPACE(1), marginBottom: SPACE(1) }}>
                <span aria-hidden>{SEVERITY_ICON[d.severity]}</span>
                <span style={{ fontFamily: TOKENS.uiFont }}>{d.message} <span style={{ color: TOKENS.textMuted }}>({d.ruleId})</span></span>
              </li>
            ))}
          </ul>
        </div>
      ) : files.length === 0 ? (
        <p style={{ padding: SPACE(3), fontFamily: TOKENS.uiFont, color: TOKENS.textMuted }}>Add a trigger and steps to see generated files.</p>
      ) : (
        <>
          <div role="tablist" aria-label="Generated files" style={{ display: 'flex', flexWrap: 'wrap', borderBottom: `1px solid ${TOKENS.border}` }}>
            {files.map((f) => (
              <button
                key={f.path}
                role="tab"
                aria-selected={active?.path === f.path}
                onClick={() => setActivePath(f.path)}
                style={{
                  fontFamily: TOKENS.monoFont, fontSize: '0.8em', cursor: 'pointer',
                  padding: `${SPACE(1)} ${SPACE(2)}`, border: 'none',
                  borderBottom: active?.path === f.path ? `2px solid ${TOKENS.focusRing}` : '2px solid transparent',
                  background: 'none', color: active?.path === f.path ? TOKENS.text : TOKENS.textMuted,
                }}
              >
                {f.path}
              </button>
            ))}
          </div>
          {active && (
            <pre aria-label={`Preview of ${active.path}`} style={{ margin: 0, padding: SPACE(2), overflow: 'auto', flex: 1, fontFamily: TOKENS.monoFont, fontSize: '0.85em', whiteSpace: 'pre' }}>
              {active.content}
            </pre>
          )}
        </>
      )}
    </section>
  );
}
