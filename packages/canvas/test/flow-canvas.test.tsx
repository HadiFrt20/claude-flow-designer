import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EditorStore } from '../src/store.js';
import { FlowCanvas } from '../src/components/FlowCanvas.js';
import { Palette, makeNode } from '../src/components/Palette.js';
import userEvent from '@testing-library/user-event';

describe('FlowCanvas', () => {
  it('renders a node with its label and kind', () => {
    const store = new EditorStore();
    store.addNode({ id: 'a1', kind: 'agent', label: 'Summarize', position: { x: 0, y: 0 }, data: { prompt: 'go' } });
    render(<FlowCanvas store={store} />);
    expect(screen.getByText('Summarize')).toBeInTheDocument();
    expect(screen.getByText('agent')).toBeInTheDocument();
  });

  it('the workflow.meta root renders a source handle and no target handle', () => {
    const store = new EditorStore();
    store.addNode({ id: 'm1', kind: 'workflow.meta', label: 'go', position: { x: 0, y: 0 }, data: { name: 'go', description: 'd' } });
    const { container } = render(<FlowCanvas store={store} />);
    // React Flow tags handles with .react-flow__handle + a source/target class.
    expect(container.querySelector('.react-flow__handle.source')).not.toBeNull();
    expect(container.querySelector('.react-flow__handle.target')).toBeNull();
  });

  it('output.return renders a target handle and no source handle', () => {
    const store = new EditorStore();
    store.addNode({ id: 'r1', kind: 'output.return', label: 'r', position: { x: 0, y: 0 }, data: { source: 'a', transform: 'none' } });
    const { container } = render(<FlowCanvas store={store} />);
    expect(container.querySelector('.react-flow__handle.target')).not.toBeNull();
    expect(container.querySelector('.react-flow__handle.source')).toBeNull();
  });

  it('renders a parallel node as a fan-out with a concurrency label over its source', () => {
    const store = new EditorStore();
    store.addNode({ id: 'list', kind: 'agent', label: 'List', position: { x: 0, y: 0 }, data: { prompt: 'list', schema: { type: 'object', properties: { dims: { type: 'array' } } } } });
    store.addNode({ id: 'rev', kind: 'parallel', label: 'Review each', position: { x: 0, y: 0 }, data: { source: 'list', sourceField: 'dims', itemVar: 'd', itemPrompt: 'Review {{d}}.' } });
    render(<FlowCanvas store={store} />);
    // The concurrency badge names it as concurrent AND shows the honest source it maps over.
    expect(screen.getByText(/concurrent · one agent × list\.dims/)).toBeInTheDocument();
  });

  it('renders a pipeline node as a fan-out labelled sequential-per-item', () => {
    const store = new EditorStore();
    store.addNode({ id: 'grade', kind: 'pipeline', label: 'Grade', position: { x: 0, y: 0 }, data: { source: 'args', itemPrompt: 'Grade {{item}}.' } });
    render(<FlowCanvas store={store} />);
    expect(screen.getByText(/sequential · one agent × args/)).toBeInTheDocument();
  });

  it('renders a fanout node with one lane per branch and a lane count', () => {
    const store = new EditorStore();
    store.addNode({ id: 'fo', kind: 'fanout', label: 'Angles', position: { x: 0, y: 0 }, data: { mode: 'parallel', branches: [
      { kind: 'thunk', prompt: 'a', label: 'speed' },
      { kind: 'thunk', prompt: 'b', label: 'safety' },
      { kind: 'map', source: 'items', sourceField: 'files', itemVar: 'f', itemPrompt: 'do {{f}}' },
    ] } });
    render(<FlowCanvas store={store} />);
    expect(screen.getByText(/⇉ concurrent · 3 lanes/)).toBeInTheDocument();
    // a thunk lane shows its label; a map lane shows × <source>
    expect(screen.getByText('speed')).toBeInTheDocument();
    expect(screen.getByText('× items.files')).toBeInTheDocument();
  });

  it('labels a promiseAll fanout as Promise.all', () => {
    const store = new EditorStore();
    store.addNode({ id: 'fo', kind: 'fanout', label: 'All', position: { x: 0, y: 0 }, data: { mode: 'promiseAll', branches: [{ kind: 'thunk', prompt: 'a' }] } });
    render(<FlowCanvas store={store} />);
    expect(screen.getByText(/\(Promise\.all\)/)).toBeInTheDocument();
  });

  it('shows a diagnostic badge on a node with an error', () => {
    const store = new EditorStore();
    // agent prompt references an unknown node → CF605 error on the node.
    store.updateMeta({ name: 't', slug: 't' });
    store.addNode({ id: 'm1', kind: 'workflow.meta', label: 'go', position: { x: 0, y: 0 }, data: { name: 't', description: 'a described workflow' } });
    store.addNode({ id: 'a', kind: 'agent', label: 'a', position: { x: 0, y: 0 }, data: { prompt: 'Use {{nope}}.' } });
    store.addNode({ id: 'r', kind: 'output.return', label: 'r', position: { x: 0, y: 0 }, data: { source: 'a', transform: 'none' } });
    store.connect('m1', 'a');
    store.connect('a', 'r');
    render(<FlowCanvas store={store} />);
    expect(screen.getByLabelText('has errors')).toBeInTheDocument();
  });
});

describe('Palette', () => {
  it('lists all groups and adds a node on click', async () => {
    const user = userEvent.setup();
    const store = new EditorStore();
    render(<Palette store={store} />);
    for (const g of ['Entry', 'Agents', 'Control']) {
      expect(screen.getByText(g)).toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: 'Agent' }));
    expect(store.current.nodes).toHaveLength(1);
    expect(store.current.nodes[0]!.kind).toBe('agent');
  });

  it('makeNode produces a schema-default node with a fresh id', () => {
    const store = new EditorStore();
    const n = makeNode(store, 'agent');
    expect(n.kind).toBe('agent');
    expect(n.id).toMatch(/^agent-\d+$/);
  });
});
