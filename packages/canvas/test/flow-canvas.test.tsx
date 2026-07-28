import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EditorStore } from '../src/store.js';
import { FlowCanvas } from '../src/components/FlowCanvas.js';
import { Palette, makeNode } from '../src/components/Palette.js';
import userEvent from '@testing-library/user-event';

describe('FlowCanvas', () => {
  it('renders a node with its label and kind', () => {
    const store = new EditorStore();
    store.addNode({ id: 'c1', kind: 'trigger.slashCommand', label: 'Deploy', position: { x: 0, y: 0 }, data: { name: 'deploy', description: 'd' } });
    render(<FlowCanvas store={store} />);
    expect(screen.getByText('Deploy')).toBeInTheDocument();
    expect(screen.getByText('trigger.slashCommand')).toBeInTheDocument();
  });

  it('shows a diagnostic badge on a node with an error', () => {
    const store = new EditorStore();
    // subagent tool not in allow set → CF301 error on the node.
    store.addNode({ id: 'c1', kind: 'trigger.slashCommand', label: 'go', position: { x: 0, y: 0 }, data: { name: 'go', description: 'a described command' } });
    store.addNode({ id: 's1', kind: 'step.subagent', label: 'a', position: { x: 0, y: 0 }, data: { name: 'a', systemPrompt: 'x', description: 'agent', tools: ['WebFetch'] } });
    store.connect('c1', 's1');
    store.updateSettings({ permissions: { allow: ['Read'], deny: [], ask: [] } });
    render(<FlowCanvas store={store} />);
    expect(screen.getByLabelText('has errors')).toBeInTheDocument();
  });
});

describe('Palette', () => {
  it('lists all four groups and adds a node on click', async () => {
    const user = userEvent.setup();
    const store = new EditorStore();
    render(<Palette store={store} />);
    for (const g of ['Triggers', 'Steps', 'Hooks', 'Control']) {
      expect(screen.getByText(g)).toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: 'Slash command' }));
    expect(store.current.nodes).toHaveLength(1);
    expect(store.current.nodes[0]!.kind).toBe('trigger.slashCommand');
  });

  it('makeNode produces a schema-default node with a fresh id', () => {
    const store = new EditorStore();
    const n = makeNode(store, 'step.prompt');
    expect(n.kind).toBe('step.prompt');
    expect(n.id).toMatch(/^prompt-\d+$/);
  });
});
