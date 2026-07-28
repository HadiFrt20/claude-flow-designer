import { describe, it, expect } from 'vitest';
import { EditorStore } from '../src/store.js';
import type { WorkflowNode } from '@clauflow/core';

const cmd = (id: string, name: string): WorkflowNode => ({
  id, kind: 'trigger.slashCommand', label: name, position: { x: 0, y: 0 },
  data: { name, description: 'A described command for tests.' },
});
const prompt = (id: string): WorkflowNode => ({
  id, kind: 'step.prompt', label: id, position: { x: 0, y: 0 }, data: { body: 'hi' },
});

describe('EditorStore mutations', () => {
  it('adds a node and selects it', () => {
    const s = new EditorStore();
    s.addNode(cmd('c1', 'go'));
    expect(s.current.nodes).toHaveLength(1);
    expect(s.selected?.id).toBe('c1');
  });

  it('connects and disconnects nodes', () => {
    const s = new EditorStore();
    s.addNode(cmd('c1', 'go'));
    s.addNode(prompt('p1'));
    s.connect('c1', 'p1');
    expect(s.current.edges).toHaveLength(1);
    expect(s.current.edges[0]!.id).toBe('c1->p1');
    s.disconnect('c1->p1');
    expect(s.current.edges).toHaveLength(0);
  });

  it('does not create duplicate edges', () => {
    const s = new EditorStore();
    s.addNode(cmd('c1', 'go'));
    s.addNode(prompt('p1'));
    s.connect('c1', 'p1');
    s.connect('c1', 'p1');
    expect(s.current.edges).toHaveLength(1);
  });

  it('deleting a node removes its edges and clears selection', () => {
    const s = new EditorStore();
    s.addNode(cmd('c1', 'go'));
    s.addNode(prompt('p1'));
    s.connect('c1', 'p1');
    s.select('c1');
    s.deleteNode('c1');
    expect(s.current.nodes).toHaveLength(1);
    expect(s.current.edges).toHaveLength(0);
    expect(s.selected).toBeNull();
  });

  it('updates node data (shallow merge)', () => {
    const s = new EditorStore();
    s.addNode(cmd('c1', 'go'));
    s.updateNodeData('c1', { description: 'new desc' });
    const node = s.current.nodes[0]!;
    if (node.kind === 'trigger.slashCommand') {
      expect(node.data.description).toBe('new desc');
      expect(node.data.name).toBe('go'); // untouched
    }
  });

  it('moveNode changes position', () => {
    const s = new EditorStore();
    s.addNode(cmd('c1', 'go'));
    s.moveNode('c1', { x: 100, y: 50 });
    expect(s.current.nodes[0]!.position).toEqual({ x: 100, y: 50 });
  });
});

describe('undo / redo', () => {
  it('undoes and redoes an add', () => {
    const s = new EditorStore();
    s.addNode(cmd('c1', 'go'));
    expect(s.canUndo()).toBe(true);
    s.undo();
    expect(s.current.nodes).toHaveLength(0);
    expect(s.canRedo()).toBe(true);
    s.redo();
    expect(s.current.nodes).toHaveLength(1);
  });

  it('a new mutation clears the redo stack', () => {
    const s = new EditorStore();
    s.addNode(cmd('c1', 'go'));
    s.undo();
    s.addNode(cmd('c2', 'other'));
    expect(s.canRedo()).toBe(false);
  });

  it('does not mutate prior snapshots (immutability)', () => {
    const s = new EditorStore();
    s.addNode(cmd('c1', 'go'));
    const before = s.current;
    s.updateNodeData('c1', { description: 'changed' });
    // The previous snapshot object is untouched.
    expect(before.nodes[0]!.kind === 'trigger.slashCommand' && before.nodes[0]!.data.description).toBe(
      'A described command for tests.',
    );
  });
});

describe('copy / paste', () => {
  it('pastes a clone with a fresh id and offset', () => {
    const s = new EditorStore();
    s.addNode(cmd('c1', 'go'));
    s.copy('c1');
    expect(s.hasClipboard()).toBe(true);
    s.paste();
    expect(s.current.nodes).toHaveLength(2);
    const ids = s.current.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('paste is a no-op with an empty clipboard', () => {
    const s = new EditorStore();
    s.paste();
    expect(s.current.nodes).toHaveLength(0);
  });
});

describe('validation + gate + acks', () => {
  it('surfaces diagnostics from core', () => {
    const s = new EditorStore();
    s.addNode(prompt('p1')); // no trigger → CF001
    expect(s.diagnostics().map((d) => d.ruleId)).toContain('CF001');
  });

  it('gate blocks on error and passes once fixed', () => {
    const s = new EditorStore();
    s.addNode(prompt('p1'));
    expect(s.gate().ok).toBe(false);
    s.addNode(cmd('c1', 'go'));
    s.connect('c1', 'p1');
    expect(s.gate().ok).toBe(true);
  });

  it('toggleAck unblocks a warning and persists to meta', () => {
    const s = new EditorStore();
    s.addNode(cmd('c1', 'code-review')); // CF008 warn (shadows bundled skill)
    expect(s.gate().ok).toBe(false);
    s.toggleAck('CF008');
    expect(s.current.meta.ackedWarnings).toContain('CF008');
    expect(s.gate().ok).toBe(true);
    s.toggleAck('CF008'); // toggling off re-blocks
    expect(s.gate().ok).toBe(false);
  });

  it('applyQuickFix runs a core transform and is undoable', () => {
    const s = new EditorStore();
    s.addNode(cmd('c1', 'code-review'));
    const diag = s.diagnostics().find((d) => d.ruleId === 'CF008' && d.quickFix)!;
    s.applyQuickFix(diag.quickFix!);
    expect(s.diagnostics().map((d) => d.ruleId)).not.toContain('CF008');
    s.undo();
    expect(s.diagnostics().map((d) => d.ruleId)).toContain('CF008');
  });
});

describe('subscription', () => {
  it('notifies listeners on change and stops after unsubscribe', () => {
    const s = new EditorStore();
    let count = 0;
    const unsub = s.subscribe(() => count++);
    s.addNode(cmd('c1', 'go'));
    expect(count).toBe(2); // addNode commit + select
    unsub();
    s.addNode(cmd('c2', 'x'));
    expect(count).toBe(2);
  });
});
