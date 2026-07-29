// Node palette, grouped Entry / Agents / Control. Click adds a node at a default
// position (drag-drop onto the canvas is layered on in the host, but a
// click-to-add path keeps the palette fully keyboard-accessible — a11y floor).
import type { EditorStore } from '../store.js';
import { PALETTE, defaultData } from '../fields.js';
import { TOKENS, SPACE, ACCENT, CATEGORY_GLYPH, categoryOf } from '../tokens.js';
import type { NodeKind, WorkflowNode } from '@clauflow/core';

export function makeNode(store: EditorStore, kind: NodeKind, position = { x: 80, y: 80 }): WorkflowNode {
  return {
    id: store.freshId(kind),
    kind,
    label: kind.split('.')[1] ?? kind,
    position,
    data: defaultData(kind),
  } as WorkflowNode;
}

export function Palette({ store }: { store: EditorStore }) {
  return (
    <nav aria-label="Node palette" style={{ fontFamily: TOKENS.uiFont, color: TOKENS.text, background: TOKENS.surfaceRaised, padding: SPACE(2), overflowY: 'auto' }}>
      {PALETTE.map((group) => (
        <div key={group.group} style={{ marginBottom: SPACE(3) }}>
          <div style={{ fontSize: '0.75em', textTransform: 'uppercase', letterSpacing: '0.05em', color: TOKENS.textMuted, marginBottom: SPACE(1) }}>
            {group.group}
          </div>
          {group.entries.map((entry) => {
            const cat = categoryOf(entry.kind);
            return (
              <button
                key={entry.kind}
                type="button"
                onClick={() => store.addNode(makeNode(store, entry.kind))}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('application/clauflow-kind', entry.kind)}
                style={{
                  display: 'flex', gap: SPACE(1), alignItems: 'center', width: '100%', textAlign: 'left',
                  marginBottom: SPACE(1), padding: SPACE(1), cursor: 'pointer',
                  borderRadius: '2px', border: `1px solid ${TOKENS.border}`, borderLeft: `2px solid ${ACCENT[cat]}`,
                  background: TOKENS.surface, color: TOKENS.text, fontFamily: TOKENS.uiFont,
                }}
              >
                <span aria-hidden style={{ fontFamily: TOKENS.monoFont, color: ACCENT[cat] }}>{CATEGORY_GLYPH[cat]}</span>
                {entry.label}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
