// "Story per node panel" (DESIGN-BRIEF acceptance, test equivalent of Storybook):
// render the PropertyPanel for EVERY node kind with schema-default data and assert
// each declared field's control is present. Catches a descriptor/renderer break
// for any kind, not just the ones used in the gallery.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EditorStore } from '../src/store.js';
import { PropertyPanel } from '../src/components/PropertyPanel.js';
import { FIELD_DESCRIPTORS, defaultData } from '../src/fields.js';
import { NODE_KINDS, type WorkflowNode } from '@clauflow/core';

describe('PropertyPanel renders for every node kind', () => {
  for (const kind of NODE_KINDS) {
    it(`${kind}: renders and exposes every declared field control`, () => {
      const store = new EditorStore();
      const node = { id: 'n1', kind, label: kind, position: { x: 0, y: 0 }, data: defaultData(kind) } as WorkflowNode;
      store.addNode(node);
      store.select('n1');
      render(<PropertyPanel store={store} />);

      // Header shows the kind.
      expect(screen.getByText(kind)).toBeInTheDocument();
      // Every descriptor's control is reachable by its accessible label. Advanced
      // groups render collapsed via <details> but the inputs are still in the DOM.
      for (const f of FIELD_DESCRIPTORS[kind]) {
        expect(screen.getByLabelText(f.label), `${kind} missing field ${f.key}`).toBeInTheDocument();
      }
    });
  }
});
