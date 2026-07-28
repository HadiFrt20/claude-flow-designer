import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorStore } from '../src/store.js';
import { ProblemsPanel } from '../src/components/ProblemsPanel.js';
import { PropertyPanel } from '../src/components/PropertyPanel.js';
import { SettingsPanel } from '../src/components/SettingsPanel.js';
import { PreviewPane, previewOf } from '../src/components/PreviewPane.js';
import { runnerCommand } from '../src/components/ExportDialog.js';
import type { WorkflowNode } from '@clauflow/core';

const cmd = (name: string): WorkflowNode => ({
  id: 'c1', kind: 'trigger.slashCommand', label: name, position: { x: 0, y: 0 },
  data: { name, description: 'A described command.' },
});

describe('ProblemsPanel', () => {
  it('renders a row per diagnostic and applies a quick fix on click', async () => {
    const user = userEvent.setup();
    const store = new EditorStore();
    store.addNode(cmd('code-review')); // CF008 warn + quick fix "Rename to code-review-custom"
    render(<ProblemsPanel store={store} />);

    // The CF008 message is present.
    expect(screen.getByText(/shadows a bundled skill/)).toBeInTheDocument();
    // Quick-fix button applies the transform.
    const fixBtn = screen.getByRole('button', { name: /Rename to/ });
    await user.click(fixBtn);
    expect(store.diagnostics().map((d) => d.ruleId)).not.toContain('CF008');
  });

  it('ack checkbox toggles meta.ackedWarnings', async () => {
    const user = userEvent.setup();
    const store = new EditorStore();
    store.addNode(cmd('code-review'));
    render(<ProblemsPanel store={store} />);
    const ack = screen.getByLabelText('Acknowledge CF008');
    await user.click(ack);
    expect(store.current.meta.ackedWarnings).toContain('CF008');
  });

  it('shows the empty state when there are no problems', () => {
    const store = new EditorStore();
    store.addNode(cmd('deploy'));
    render(<ProblemsPanel store={store} />);
    expect(screen.getByText(/No problems/)).toBeInTheDocument();
  });
});

describe('PropertyPanel', () => {
  it('renders every Basic field and edits data through the store', async () => {
    const user = userEvent.setup();
    const store = new EditorStore();
    store.addNode(cmd('deploy'));
    store.select('c1');
    render(<PropertyPanel store={store} />);

    const desc = screen.getByLabelText('Description');
    await user.clear(desc);
    await user.type(desc, 'New description');
    const node = store.current.nodes[0]!;
    if (node.kind === 'trigger.slashCommand') expect(node.data.description).toBe('New description');
  });

  it('underlines an invalid field with the diagnostic message', () => {
    const store = new EditorStore();
    // Empty description → CF006 warn on field "description".
    store.addNode({ id: 'c1', kind: 'trigger.slashCommand', label: 'x', position: { x: 0, y: 0 }, data: { name: 'x', description: '' } });
    store.select('c1');
    render(<PropertyPanel store={store} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/empty description/i);
  });

  // These structured fields live in the Advanced group (a collapsed <details>).
  // jsdom does not toggle <details> on summary click, so open it directly — the
  // control reachability, not the disclosure widget, is what these tests assert.
  const openAdvanced = () => {
    const summary = screen.getByText('Advanced');
    (summary.closest('details') as HTMLDetailsElement).open = true;
  };

  it('argList control adds a structured {name, placeholder} arg (by hand)', async () => {
    const user = userEvent.setup();
    const store = new EditorStore();
    store.addNode(cmd('deploy'));
    store.select('c1');
    render(<PropertyPanel store={store} />);
    openAdvanced();
    await user.click(screen.getByRole('button', { name: 'add arg' }));
    await user.type(screen.getByLabelText('arg 1 name'), 'issue');
    const node = store.current.nodes[0]!;
    if (node.kind === 'trigger.slashCommand') {
      expect(node.data.args).toEqual([{ name: 'issue', placeholder: '$1' }]);
    }
  });

  it('keyValue control parses http headers into a Record', async () => {
    const user = userEvent.setup();
    const store = new EditorStore();
    store.addNode({ id: 'h1', kind: 'hook.http', label: 'h', position: { x: 0, y: 0 }, data: { url: 'https://x' } });
    store.select('h1');
    render(<PropertyPanel store={store} />);
    openAdvanced();
    await user.type(screen.getByLabelText('Headers'), 'Authorization: Bearer t');
    const node = store.current.nodes[0]!;
    if (node.kind === 'hook.http') expect(node.data.headers).toEqual({ Authorization: 'Bearer t' });
  });

  it('json control parses mcp input into an object', async () => {
    const user = userEvent.setup();
    const store = new EditorStore();
    store.addNode({ id: 'm1', kind: 'step.mcpTool', label: 'm', position: { x: 0, y: 0 }, data: { server: 's', tool: 't' } });
    store.select('m1');
    render(<PropertyPanel store={store} />);
    openAdvanced();
    const input = screen.getByLabelText('Input');
    await user.clear(input);
    await user.type(input, '{{"a":1}');
    const node = store.current.nodes[0]!;
    if (node.kind === 'step.mcpTool') expect(node.data.input).toEqual({ a: 1 });
  });

  it('multiSelect control toggles frontmatterHooks', async () => {
    const user = userEvent.setup();
    const store = new EditorStore();
    store.addNode({ id: 's1', kind: 'step.subagent', label: 's', position: { x: 0, y: 0 }, data: { name: 'a', systemPrompt: 'x', description: 'agent' } });
    store.select('s1');
    render(<PropertyPanel store={store} />);
    openAdvanced();
    await user.click(within(screen.getByRole('group', { name: 'Frontmatter hooks' })).getByLabelText('Stop'));
    const node = store.current.nodes[0]!;
    if (node.kind === 'step.subagent') expect(node.data.frontmatterHooks).toEqual(['Stop']);
  });

  it('shows a placeholder prompt when nothing is selected', () => {
    const store = new EditorStore();
    render(<PropertyPanel store={store} />);
    expect(screen.getByText(/Select a node/)).toBeInTheDocument();
  });
});

describe('SettingsPanel model×effort advisor', () => {
  it('surfaces CF402 (Haiku + max) inline on the effort control', async () => {
    const store = new EditorStore();
    store.addNode(cmd('deploy'));
    store.updateSettings({ model: 'haiku', effort: 'max' });
    render(<SettingsPanel store={store} />);
    // CF402 message appears in the advisor.
    expect(screen.getByText(/wasteful pairing/)).toBeInTheDocument();
  });
});

describe('PreviewPane', () => {
  it('previewOf returns generated files for a valid graph', () => {
    const store = new EditorStore();
    store.addNode(cmd('deploy'));
    const r = previewOf(store);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.files.some((f) => f.path.endsWith('SKILL.md'))).toBe(true);
  });

  it('previewOf returns blocking diagnostics when the gate blocks', () => {
    const store = new EditorStore();
    store.addNode({ id: 'p1', kind: 'step.prompt', label: 'p', position: { x: 0, y: 0 }, data: { body: 'x' } }); // CF001
    const r = previewOf(store);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocking.map((d) => d.ruleId)).toContain('CF001');
  });

  it('renders the blocked state instead of stale output', () => {
    const store = new EditorStore();
    store.addNode({ id: 'p1', kind: 'step.prompt', label: 'p', position: { x: 0, y: 0 }, data: { body: 'x' } });
    render(<PreviewPane store={store} debounceMs={0} />);
    expect(screen.getByText(/Export is blocked/)).toBeInTheDocument();
  });
});

describe('runnerCommand', () => {
  it('extracts the claude invocation from run.sh', () => {
    const cmdLine = runnerCommand([{ path: 'run.sh', content: '#!/bin/bash\nset -euo pipefail\nclaude -p \'go\' --model \'opus\'\n' }]);
    expect(cmdLine).toBe("claude -p 'go' --model 'opus'");
  });
  it('returns null when there is no run.sh', () => {
    expect(runnerCommand([{ path: 'x.md', content: 'hi' }])).toBeNull();
  });
});
