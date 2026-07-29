import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorStore } from '../src/store.js';
import { ProblemsPanel } from '../src/components/ProblemsPanel.js';
import { PropertyPanel } from '../src/components/PropertyPanel.js';
import { SettingsPanel } from '../src/components/SettingsPanel.js';
import { PreviewPane, previewOf } from '../src/components/PreviewPane.js';
import { workflowInvocation } from '../src/components/ExportDialog.js';
import type { WorkflowNode } from '@clauflow/core';

const meta = (name: string): WorkflowNode => ({
  id: 'm1', kind: 'workflow.meta', label: name, position: { x: 0, y: 0 },
  data: { name, description: 'A described workflow.' },
});
const agent = (id: string, prompt = 'do it'): WorkflowNode => ({
  id, kind: 'agent', label: id, position: { x: 0, y: 0 }, data: { prompt },
});
const ret = (id: string, source: string): WorkflowNode => ({
  id, kind: 'output.return', label: id, position: { x: 0, y: 0 }, data: { source, transform: 'none' },
});

/** Seed a complete, fully-valid workflow (meta → agent → return). */
function validStore(name = 't'): EditorStore {
  const s = new EditorStore();
  s.updateMeta({ name, slug: name });
  s.addNode(meta(name));
  s.addNode(agent('a'));
  s.addNode(ret('r', 'a'));
  s.connect('m1', 'a');
  s.connect('a', 'r');
  return s;
}

describe('ProblemsPanel', () => {
  it('renders a row per diagnostic and applies a quick fix on click', async () => {
    const user = userEvent.setup();
    const store = validStore('workflows'); // CF008 warn + rename quick fix
    store.updateNodeData('m1', { name: 'workflows' });
    render(<ProblemsPanel store={store} />);

    expect(screen.getByText(/shadows a bundled command/)).toBeInTheDocument();
    const fixBtn = screen.getByRole('button', { name: /Rename to/ });
    await user.click(fixBtn);
    expect(store.diagnostics().map((d) => d.ruleId)).not.toContain('CF008');
  });

  it('ack checkbox toggles meta.ackedWarnings', async () => {
    const user = userEvent.setup();
    const store = validStore('workflows');
    store.updateNodeData('m1', { name: 'workflows' });
    render(<ProblemsPanel store={store} />);
    const ack = screen.getByLabelText('Acknowledge CF008');
    await user.click(ack);
    expect(store.current.meta.ackedWarnings).toContain('CF008');
  });

  it('shows the empty state when there are no problems', () => {
    const store = validStore('deploy');
    render(<ProblemsPanel store={store} />);
    expect(screen.getByText(/No problems/)).toBeInTheDocument();
  });
});

describe('PropertyPanel', () => {
  it('renders every Basic field and edits data through the store', async () => {
    const user = userEvent.setup();
    const store = validStore('deploy');
    store.select('m1');
    render(<PropertyPanel store={store} />);

    const desc = screen.getByLabelText('Description');
    await user.clear(desc);
    await user.type(desc, 'New description');
    const node = store.current.nodes.find((n) => n.id === 'm1')!;
    if (node.kind === 'workflow.meta') expect(node.data.description).toBe('New description');
  });

  it('underlines an invalid field with the diagnostic message', () => {
    const store = validStore('deploy');
    // Empty workflow description → CF006 warn on field "description".
    store.updateNodeData('m1', { description: '' });
    store.select('m1');
    render(<PropertyPanel store={store} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/empty description/i);
  });

  // The schema field lives in the Advanced group (a collapsed <details>). jsdom
  // does not toggle <details> on summary click, so open it directly.
  const openAdvanced = () => {
    const summary = screen.getByText('Advanced');
    (summary.closest('details') as HTMLDetailsElement).open = true;
  };

  it('json control parses an agent schema into an object', async () => {
    const user = userEvent.setup();
    const store = validStore('deploy');
    store.select('a');
    render(<PropertyPanel store={store} />);
    openAdvanced();
    const input = screen.getByLabelText('Output schema');
    await user.clear(input);
    await user.type(input, '{{"type":"object"}');
    const node = store.current.nodes.find((n) => n.id === 'a')!;
    if (node.kind === 'agent') expect(node.data.schema).toEqual({ type: 'object' });
  });

  it('transform select edits the return transform', async () => {
    const user = userEvent.setup();
    const store = validStore('deploy');
    store.select('r');
    render(<PropertyPanel store={store} />);
    openAdvanced();
    await user.selectOptions(screen.getByLabelText('Transform'), 'flatten');
    const node = store.current.nodes.find((n) => n.id === 'r')!;
    if (node.kind === 'output.return') expect(node.data.transform).toBe('flatten');
  });

  it('shows a placeholder prompt when nothing is selected', () => {
    const store = new EditorStore();
    render(<PropertyPanel store={store} />);
    expect(screen.getByText(/Select a node/)).toBeInTheDocument();
  });
});

describe('SettingsPanel', () => {
  it('edits the default model through the store', async () => {
    const user = userEvent.setup();
    const store = validStore('deploy');
    render(<SettingsPanel store={store} />);
    await user.type(screen.getByLabelText('Model'), 'opus');
    expect(store.current.settings.model).toBe('opus');
  });
});

describe('PreviewPane', () => {
  it('previewOf returns generated files for a valid graph', () => {
    const store = validStore('deploy');
    const r = previewOf(store);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.files.some((f) => f.path.endsWith('.js'))).toBe(true);
  });

  it('previewOf returns blocking diagnostics when the gate blocks', () => {
    const store = new EditorStore();
    store.addNode(agent('a')); // no meta entry point → CF001
    const r = previewOf(store);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocking.map((d) => d.ruleId)).toContain('CF001');
  });

  it('renders the blocked state instead of stale output', () => {
    const store = new EditorStore();
    store.addNode(agent('a'));
    render(<PreviewPane store={store} debounceMs={0} />);
    expect(screen.getByText(/Export is blocked/)).toBeInTheDocument();
  });
});

describe('workflowInvocation', () => {
  it('derives /<name> from the meta node', () => {
    const store = validStore('deploy');
    expect(workflowInvocation(store.current)).toBe('/deploy');
  });
});
