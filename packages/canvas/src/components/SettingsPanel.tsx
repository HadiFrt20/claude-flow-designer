// Workflow-settings panel. In the dynamic-workflow model the emitted .js reads
// only `model` (a default for stages that don't route their own) and `env`; the
// rest of the old asset-era settings are gone (M6). Settings-scoped diagnostics
// (no nodeId) drive the inline advisor next to the control that causes them.
import { useEditor } from '../useEditor.js';
import type { EditorStore } from '../store.js';
import { TOKENS, SPACE, RADIUS, SEVERITY_COLOR, SEVERITY_ICON } from '../tokens.js';

export function SettingsPanel({ store }: { store: EditorStore }) {
  useEditor(store);
  const s = store.current.settings;
  const settingsDiags = store.diagnostics().filter((d) => !d.nodeId);
  const advisorFor = (field: string) => settingsDiags.filter((d) => d.field === field);

  return (
    <aside aria-label="Workflow settings" style={{ fontFamily: TOKENS.uiFont, color: TOKENS.text, background: TOKENS.surfaceRaised, padding: SPACE(2) }}>
      <h3 style={{ marginTop: 0 }}>Workflow settings</h3>

      <Row label="Default model">
        <input
          value={s.model ?? ''}
          onChange={(e) => store.updateSettings({ model: e.target.value || undefined })}
          aria-label="Model"
          placeholder="sonnet, opus, claude-opus-4-8…"
          style={input(advisorFor('model').length > 0)}
        />
        <Advisor diags={advisorFor('model')} />
        <p style={{ fontSize: '0.75em', color: TOKENS.textMuted, margin: `${SPACE(1)} 0 0` }}>
          Applied to agent stages that don't set their own model.
        </p>
      </Row>

      <Row label="Environment variables">
        <textarea
          aria-label="Environment variables"
          rows={3}
          value={Object.entries(s.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n')}
          onChange={(e) => {
            const env: Record<string, string> = {};
            for (const line of e.target.value.split('\n')) {
              const idx = line.indexOf('=');
              if (idx < 0) continue;
              const k = line.slice(0, idx).trim();
              if (k) env[k] = line.slice(idx + 1).trim();
            }
            store.updateSettings({ env: Object.keys(env).length ? env : undefined });
          }}
          placeholder="KEY=value"
          style={{ ...input(settingsDiags.some((d) => d.field === 'env')), fontFamily: TOKENS.monoFont }}
        />
        <Advisor diags={settingsDiags.filter((d) => d.field === 'env')} />
      </Row>
    </aside>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: SPACE(3) }}>
      <div style={{ fontSize: '0.8em', color: TOKENS.textMuted, marginBottom: SPACE(1) }}>{label}</div>
      {children}
    </div>
  );
}

function Advisor({ diags }: { diags: ReturnType<EditorStore['diagnostics']> }) {
  if (diags.length === 0) return null;
  return (
    <ul role="list" style={{ listStyle: 'none', margin: `${SPACE(1)} 0 0`, padding: 0 }}>
      {diags.map((d, i) => (
        <li key={i} style={{ fontSize: '0.78em', color: SEVERITY_COLOR[d.severity], display: 'flex', gap: SPACE(1) }}>
          <span aria-hidden>{SEVERITY_ICON[d.severity]}</span>
          <span>{d.message}</span>
        </li>
      ))}
    </ul>
  );
}

function input(invalid: boolean): React.CSSProperties {
  return {
    display: 'block', width: '100%', boxSizing: 'border-box', padding: SPACE(1),
    borderRadius: RADIUS.input, border: `1px solid ${invalid ? TOKENS.warn : TOKENS.border}`,
    background: TOKENS.surface, color: TOKENS.text, fontFamily: TOKENS.monoFont,
  };
}
