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

      <Row label="Output style">
        <input value={s.outputStyle ?? ''} onChange={(e) => store.updateSettings({ outputStyle: e.target.value || undefined })} aria-label="Output style" style={input(false)} />
      </Row>

      <Row label="Permissions">
        <PermField store={store} bucket="allow" values={s.permissions?.allow ?? []} />
        <PermField store={store} bucket="deny" values={s.permissions?.deny ?? []} />
        <PermField store={store} bucket="ask" values={s.permissions?.ask ?? []} />
        <Advisor diags={settingsDiags.filter((d) => d.field?.startsWith('permissions'))} />
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

      <Row label="Hooks">
        <Check store={store} label="Disable all hooks" checked={s.disableAllHooks ?? false} onToggle={(v) => store.updateSettings({ disableAllHooks: v || undefined })} />
      </Row>

      <Row label="Headless runner">
        <Check
          store={store}
          label="Emit run.sh (claude -p)"
          checked={s.headless?.enabled ?? false}
          onToggle={(v) => store.updateSettings({ headless: { ...(s.headless ?? { enabled: false }), enabled: v } })}
        />
        {s.headless?.enabled && (
          <div style={{ marginTop: SPACE(2), paddingLeft: SPACE(2), borderLeft: `1px solid ${TOKENS.border}` }}>
            <label style={{ fontSize: '0.8em', color: TOKENS.textMuted }}>Output format</label>
            <select
              aria-label="Output format"
              value={s.headless.outputFormat ?? ''}
              onChange={(e) => store.updateSettings({ headless: { ...s.headless!, outputFormat: (e.target.value || undefined) as typeof s.headless.outputFormat } })}
              style={input(settingsDiags.some((d) => d.field === 'headless.outputFormat'))}
            >
              <option value="">text</option>
              <option value="json">json</option>
              <option value="stream-json">stream-json</option>
            </select>
            <Advisor diags={settingsDiags.filter((d) => d.field?.startsWith('headless'))} />
            <label style={{ fontSize: '0.8em', color: TOKENS.textMuted }}>Max turns</label>
            <input
              type="number"
              aria-label="Max turns"
              value={s.headless.maxTurns ?? ''}
              onChange={(e) => store.updateSettings({ headless: { ...s.headless!, maxTurns: e.target.value === '' ? undefined : Number(e.target.value) } })}
              style={input(false)}
            />
            <Check store={store} label="Worktree" checked={s.headless.worktree ?? false} onToggle={(v) => store.updateSettings({ headless: { ...s.headless!, worktree: v || undefined } })} />
            <Check store={store} label="Verbose" checked={s.headless.verbose ?? false} onToggle={(v) => store.updateSettings({ headless: { ...s.headless!, verbose: v || undefined } })} />
          </div>
        )}
      </Row>
    </aside>
  );
}

function Check({ label, checked, onToggle }: { store: EditorStore; label: string; checked: boolean; onToggle: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', gap: SPACE(1), alignItems: 'center' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} aria-label={label} />
      <span style={{ color: TOKENS.textMuted, fontSize: '0.85em' }}>{label}</span>
    </label>
  );
}

function PermField({ store, bucket, values }: { store: EditorStore; bucket: 'allow' | 'deny' | 'ask'; values: string[] }) {
  const current = store.current.settings.permissions ?? { allow: [], deny: [], ask: [] };
  return (
    <div style={{ marginBottom: SPACE(1) }}>
      <label style={{ fontSize: '0.75em', color: TOKENS.textMuted }}>{bucket}</label>
      <textarea
        aria-label={`permissions ${bucket}`}
        rows={2}
        value={values.join('\n')}
        onChange={(e) => {
          const list = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
          const next = { ...current, [bucket]: list };
          const empty = !next.allow.length && !next.deny.length && !next.ask.length;
          store.updateSettings({ permissions: empty ? undefined : next });
        }}
        placeholder={bucket === 'deny' ? 'Bash(rm -rf *)' : 'Bash(git *)'}
        style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: SPACE(1), borderRadius: RADIUS.input, border: `1px solid ${TOKENS.border}`, background: TOKENS.surface, color: TOKENS.text, fontFamily: TOKENS.monoFont }}
      />
    </div>
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
