// Property panel for the selected node. Renders EVERY field from the descriptor
// table, grouped Basic / Advanced. Field-level diagnostics underline the input
// (same Diagnostic object as the node badge + Problems row).
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../useEditor.js';
import type { EditorStore } from '../store.js';
import { FIELD_DESCRIPTORS, type FieldDescriptor } from '../fields.js';
import { TOKENS, SPACE, RADIUS, categoryOf, CATEGORY_GLYPH, ACCENT } from '../tokens.js';
import type { WorkflowNode } from '@clauflow/core';

/**
 * A textarea that keeps its own text buffer so the user can type intermediate
 * (temporarily unparseable) values. `format` renders the committed value into
 * text; `parse` turns text into a committed value (or `undefined` to skip a
 * commit without losing the typed text). Used by json / keyValue fields.
 */
function BufferedTextarea({
  value, format, parse, onCommit, label, invalid, placeholder,
}: {
  value: unknown;
  format: (v: unknown) => string;
  parse: (text: string) => { commit: true; value: unknown } | { commit: false };
  onCommit: (v: unknown) => void;
  label: string;
  invalid: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(() => format(value));
  const dirty = useRef(false);
  // Re-sync from the store only when the external value changes and we're not
  // mid-edit (prevents clobbering the buffer on every keystroke re-render).
  useEffect(() => {
    if (!dirty.current) setText(format(value));
  }, [value, format]);
  return (
    <textarea
      value={text}
      onChange={(e) => {
        dirty.current = true;
        setText(e.target.value);
        const r = parse(e.target.value);
        if (r.commit) onCommit(r.value);
      }}
      onBlur={() => { dirty.current = false; }}
      aria-label={label}
      rows={4}
      placeholder={placeholder}
      style={{
        display: 'block', width: '100%', boxSizing: 'border-box', marginTop: SPACE(1), padding: SPACE(1),
        borderRadius: RADIUS.input, border: `1px solid ${invalid ? TOKENS.error : TOKENS.border}`,
        background: TOKENS.surface, color: TOKENS.text, fontFamily: TOKENS.monoFont,
      }}
    />
  );
}

export function PropertyPanel({ store }: { store: EditorStore }) {
  useEditor(store);
  const node = store.selected;
  if (!node) {
    return (
      <aside aria-label="Properties" style={panelStyle}>
        <p style={{ padding: SPACE(2), color: TOKENS.textMuted }}>Select a node to edit its properties.</p>
      </aside>
    );
  }

  const cat = categoryOf(node.kind);
  const descriptors = FIELD_DESCRIPTORS[node.kind];
  const basic = descriptors.filter((f) => f.group === 'Basic');
  const advanced = descriptors.filter((f) => f.group === 'Advanced');
  const fieldDiags = store.diagnostics().filter((d) => d.nodeId === node.id && d.field);

  return (
    <aside aria-label="Properties" style={panelStyle}>
      <header style={{ padding: SPACE(2), borderBottom: `1px solid ${TOKENS.border}`, borderLeft: `2px solid ${ACCENT[cat]}` }}>
        <div style={{ fontFamily: TOKENS.monoFont, color: TOKENS.textMuted }}>
          <span aria-hidden>{CATEGORY_GLYPH[cat]}</span> {node.kind}
        </div>
        <LabelInput store={store} node={node} />
      </header>
      <FieldGroup title="Basic" fields={basic} store={store} node={node} diags={fieldDiags} />
      {advanced.length > 0 && <FieldGroup title="Advanced" fields={advanced} store={store} node={node} diags={fieldDiags} defaultOpen={false} />}
    </aside>
  );
}

const panelStyle: React.CSSProperties = {
  fontFamily: TOKENS.uiFont,
  color: TOKENS.text,
  background: TOKENS.surfaceRaised,
  height: '100%',
  overflowY: 'auto',
};

function LabelInput({ store, node }: { store: EditorStore; node: WorkflowNode }) {
  return (
    <label style={{ display: 'block', marginTop: SPACE(1) }}>
      <span style={{ fontSize: '0.8em', color: TOKENS.textMuted }}>Label</span>
      <input
        value={node.label}
        onChange={(e) => store.updateNodeLabel(node.id, e.target.value)}
        aria-label="Node label"
        style={inputStyle(false)}
      />
    </label>
  );
}

function FieldGroup({
  title, fields, store, node, diags, defaultOpen = true,
}: {
  title: string;
  fields: FieldDescriptor[];
  store: EditorStore;
  node: WorkflowNode;
  diags: ReturnType<EditorStore['diagnostics']>;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} style={{ padding: SPACE(2), borderBottom: `1px solid ${TOKENS.border}` }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: SPACE(2) }}>{title}</summary>
      {fields.map((f) => (
        <Field key={f.key} f={f} store={store} node={node} diag={diags.find((d) => d.field === f.key)} />
      ))}
    </details>
  );
}

function Field({ f, store, node, diag }: { f: FieldDescriptor; store: EditorStore; node: WorkflowNode; diag?: ReturnType<EditorStore['diagnostics']>[number] }) {
  const data = node.data as Record<string, unknown>;
  const raw = data[f.key];
  const invalid = diag !== undefined;
  const set = (value: unknown) => store.updateNodeData(node.id, { [f.key]: value });

  const control = () => {
    switch (f.type) {
      case 'boolean':
        return (
          <input type="checkbox" checked={raw === true} onChange={(e) => set(e.target.checked)} aria-label={f.label} />
        );
      case 'number':
        return (
          <input
            type="number"
            value={raw === undefined ? '' : String(raw)}
            onChange={(e) => set(e.target.value === '' ? undefined : Number(e.target.value))}
            aria-label={f.label}
            style={inputStyle(invalid)}
          />
        );
      case 'select':
      case 'effort':
        return (
          <select value={(raw as string) ?? ''} onChange={(e) => set(e.target.value || undefined)} aria-label={f.label} style={inputStyle(invalid)}>
            <option value="">—</option>
            {(f.options ?? []).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        );
      case 'stringList':
        return (
          <textarea
            value={Array.isArray(raw) ? (raw as string[]).join('\n') : ''}
            onChange={(e) => set(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
            aria-label={f.label}
            rows={3}
            style={{ ...inputStyle(invalid), fontFamily: TOKENS.monoFont }}
          />
        );
      case 'multiSelect': {
        const selected = new Set(Array.isArray(raw) ? (raw as string[]) : []);
        return (
          <div role="group" aria-label={f.label} style={{ maxHeight: 140, overflowY: 'auto', border: `1px solid ${invalid ? TOKENS.error : TOKENS.border}`, borderRadius: RADIUS.input, padding: SPACE(1) }}>
            {(f.options ?? []).map((o) => (
              <label key={o} style={{ display: 'flex', gap: SPACE(1), fontSize: '0.85em' }}>
                <input
                  type="checkbox"
                  checked={selected.has(o)}
                  onChange={(e) => {
                    const nextSel = new Set(selected);
                    if (e.target.checked) nextSel.add(o);
                    else nextSel.delete(o);
                    set(nextSel.size ? [...nextSel] : undefined);
                  }}
                  aria-label={o}
                />
                {o}
              </label>
            ))}
          </div>
        );
      }
      case 'keyValue':
        return (
          <BufferedTextarea
            label={f.label}
            invalid={invalid}
            placeholder="Authorization: Bearer …"
            value={raw}
            format={(v) => Object.entries((v && typeof v === 'object' ? v : {}) as Record<string, string>).map(([k, val]) => `${k}: ${val}`).join('\n')}
            parse={(t) => {
              const next: Record<string, string> = {};
              for (const line of t.split('\n')) {
                const idx = line.indexOf(':');
                if (idx < 0) continue;
                const k = line.slice(0, idx).trim();
                if (k) next[k] = line.slice(idx + 1).trim();
              }
              return { commit: true, value: Object.keys(next).length ? next : undefined };
            }}
            onCommit={set}
          />
        );
      case 'argList': {
        const args = Array.isArray(raw) ? (raw as { name: string; placeholder: string }[]) : [];
        const setArgs = (next: typeof args) => set(next.length ? next : undefined);
        return (
          <div role="group" aria-label={f.label}>
            {args.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: SPACE(1), marginBottom: SPACE(1) }}>
                <input
                  value={a.name}
                  onChange={(e) => setArgs(args.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  aria-label={`arg ${i + 1} name`}
                  placeholder="name"
                  style={{ ...inputStyle(false), marginTop: 0 }}
                />
                <input
                  value={a.placeholder}
                  onChange={(e) => setArgs(args.map((x, j) => (j === i ? { ...x, placeholder: e.target.value } : x)))}
                  aria-label={`arg ${i + 1} placeholder`}
                  placeholder="$1"
                  style={{ ...inputStyle(false), marginTop: 0, fontFamily: TOKENS.monoFont }}
                />
                <button type="button" onClick={() => setArgs(args.filter((_, j) => j !== i))} aria-label={`remove arg ${i + 1}`}>×</button>
              </div>
            ))}
            <button type="button" aria-label="add arg" onClick={() => setArgs([...args, { name: '', placeholder: `$${args.length + 1}` }])}>+ arg</button>
          </div>
        );
      }
      case 'json':
        return (
          <BufferedTextarea
            label={f.label}
            invalid={invalid}
            placeholder="{ }"
            value={raw}
            format={(v) => (v === undefined ? '' : JSON.stringify(v, null, 2))}
            parse={(t) => {
              const trimmed = t.trim();
              if (trimmed === '') return { commit: true, value: undefined };
              try {
                return { commit: true, value: JSON.parse(trimmed) };
              } catch {
                // Invalid intermediate JSON — keep the buffer, commit nothing.
                return { commit: false };
              }
            }}
            onCommit={set}
          />
        );
      case 'textarea':
        return (
          <textarea value={(raw as string) ?? ''} onChange={(e) => set(e.target.value)} aria-label={f.label} rows={4} style={{ ...inputStyle(invalid), fontFamily: TOKENS.monoFont }} />
        );
      case 'matcher':
      case 'permissionRule':
      case 'model':
      default:
        return (
          <input
            value={(raw as string) ?? ''}
            onChange={(e) => set(e.target.value || undefined)}
            aria-label={f.label}
            placeholder={f.placeholder}
            style={{ ...inputStyle(invalid), fontFamily: f.type === 'text' ? TOKENS.uiFont : TOKENS.monoFont }}
          />
        );
    }
  };

  // Group-type fields render multiple controls, so they must NOT be wrapped in a
  // single <label> (it would steal every child's accessible name). Those controls
  // carry their own aria-labels; single-control fields keep the implicit label.
  const isGroup = f.type === 'argList' || f.type === 'multiSelect';
  const Wrapper = isGroup ? 'div' : 'label';
  return (
    <Wrapper style={{ display: 'block', marginBottom: SPACE(2) }}>
      <span style={{ fontSize: '0.8em', color: TOKENS.textMuted }}>{f.label}</span>
      {control()}
      {f.hint && !invalid && <span style={{ fontSize: '0.75em', color: TOKENS.textMuted, display: 'block' }}>{f.hint}</span>}
      {invalid && (
        <span role="alert" style={{ fontSize: '0.75em', color: TOKENS.error, display: 'block' }}>
          {diag!.message}
        </span>
      )}
    </Wrapper>
  );
}

function inputStyle(invalid: boolean): React.CSSProperties {
  return {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    marginTop: SPACE(1),
    padding: SPACE(1),
    borderRadius: RADIUS.input,
    border: `1px solid ${invalid ? TOKENS.error : TOKENS.border}`,
    background: TOKENS.surface,
    color: TOKENS.text,
    fontFamily: TOKENS.uiFont,
  };
}
