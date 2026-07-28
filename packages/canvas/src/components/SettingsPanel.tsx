// GlobalSettings panel. Model × effort advisor surfaces CF401 (xhigh/max in
// settings.json) and CF402 (Haiku + high effort) inline, next to the controls
// that cause them (DESIGN-BRIEF: advisor inline, not buried in Problems).
import { useEditor } from '../useEditor.js';
import type { EditorStore } from '../store.js';
import { TOKENS, SPACE, RADIUS, SEVERITY_COLOR, SEVERITY_ICON } from '../tokens.js';
import type { Effort, PermissionMode } from '@clauflow/core';

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const MODES: PermissionMode[] = ['default', 'plan', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions'];

export function SettingsPanel({ store }: { store: EditorStore }) {
  useEditor(store);
  const s = store.current.settings;
  // Settings-scoped diagnostics (no nodeId) drive the inline advisor.
  const settingsDiags = store.diagnostics().filter((d) => !d.nodeId);
  const advisorFor = (field: string) => settingsDiags.filter((d) => d.field === field);

  return (
    <aside aria-label="Workflow settings" style={{ fontFamily: TOKENS.uiFont, color: TOKENS.text, background: TOKENS.surfaceRaised, padding: SPACE(2) }}>
      <h3 style={{ marginTop: 0 }}>Workflow settings</h3>

      <Row label="Model">
        <input
          value={s.model ?? ''}
          onChange={(e) => store.updateSettings({ model: e.target.value || undefined })}
          aria-label="Model"
          placeholder="sonnet, opus, claude-opus-4-8…"
          style={input(advisorFor('model').length > 0)}
        />
        <Advisor diags={advisorFor('model')} />
      </Row>

      <Row label="Effort">
        <select value={s.effort ?? ''} onChange={(e) => store.updateSettings({ effort: (e.target.value || undefined) as Effort | undefined })} aria-label="Effort" style={input(advisorFor('effort').length > 0)}>
          <option value="">—</option>
          {EFFORTS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <Advisor diags={advisorFor('effort')} />
      </Row>

      <Row label="Permission mode">
        <select value={s.permissionMode ?? ''} onChange={(e) => store.updateSettings({ permissionMode: (e.target.value || undefined) as PermissionMode | undefined })} aria-label="Permission mode" style={input(advisorFor('permissionMode').length > 0)}>
          <option value="">default</option>
          {MODES.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <Advisor diags={advisorFor('permissionMode')} />
      </Row>

      <Row label="Headless runner">
        <label style={{ display: 'flex', gap: SPACE(1), alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={s.headless?.enabled ?? false}
            onChange={(e) => store.updateSettings({ headless: { ...(s.headless ?? { enabled: false }), enabled: e.target.checked } })}
            aria-label="Enable headless runner"
          />
          <span style={{ color: TOKENS.textMuted, fontSize: '0.85em' }}>Emit run.sh (claude -p)</span>
        </label>
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
