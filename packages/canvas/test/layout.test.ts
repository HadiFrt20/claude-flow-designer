import { describe, it, expect } from 'vitest';
import { needsLayout, applyLayout, layoutIfNeeded } from '../src/layout.js';
import { EditorStore } from '../src/store.js';
import type { WorkflowGraph, WorkflowNode } from '@clauflow/core';

const pos = (x: number, y: number) => ({ x, y });
const meta = (id: string): WorkflowNode => ({ id, kind: 'workflow.meta', label: id, position: pos(0, 0), data: { name: 't', description: 'd' } });
const agent = (id: string): WorkflowNode => ({ id, kind: 'agent', label: id, position: pos(0, 0), data: { prompt: 'x' } });
const ret = (id: string, source: string): WorkflowNode => ({ id, kind: 'output.return', label: id, position: pos(0, 0), data: { source, transform: 'none' } });

function chain(): WorkflowGraph {
  return {
    version: 1, meta: { name: 't', slug: 't' }, settings: {},
    nodes: [meta('m'), agent('a'), agent('b'), ret('r', 'b')],
    edges: [
      { id: 'e1', source: 'm', target: 'a' },
      { id: 'e2', source: 'a', target: 'b' },
      { id: 'e3', source: 'b', target: 'r' },
    ],
  };
}

describe('needsLayout', () => {
  it('is true when nodes share a position (template {0,0} case)', () => {
    expect(needsLayout(chain())).toBe(true);
  });

  it('is false for a single node', () => {
    const g: WorkflowGraph = { version: 1, meta: { name: 't', slug: 't' }, settings: {}, nodes: [meta('m')], edges: [] };
    expect(needsLayout(g)).toBe(false);
  });

  it('is false once positions are distinct (user-arranged)', () => {
    expect(needsLayout(applyLayout(chain()))).toBe(false);
  });
});

describe('applyLayout', () => {
  it('assigns strictly increasing columns down the chain', () => {
    const laid = applyLayout(chain());
    const x = Object.fromEntries(laid.nodes.map((n) => [n.id, n.position.x]));
    expect(x.m).toBeLessThan(x.a);
    expect(x.a).toBeLessThan(x.b);
    expect(x.b).toBeLessThan(x.r);
  });

  it('gives every node a distinct position', () => {
    const laid = applyLayout(chain());
    const keys = laid.nodes.map((n) => `${n.position.x},${n.position.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is deterministic', () => {
    expect(applyLayout(chain())).toEqual(applyLayout(chain()));
  });

  it('places sibling arms in the same column, different rows', () => {
    const g: WorkflowGraph = {
      version: 1, meta: { name: 't', slug: 't' }, settings: {},
      nodes: [meta('m'), agent('a'), agent('b'), ret('r', 'a')],
      edges: [
        { id: 'e1', source: 'm', target: 'a' },
        { id: 'e2', source: 'm', target: 'b' },
        { id: 'e3', source: 'a', target: 'r' },
      ],
    };
    const laid = applyLayout(g);
    const byId = Object.fromEntries(laid.nodes.map((n) => [n.id, n.position]));
    // a and b are both one hop from m → same column, different rows.
    expect(byId.a!.x).toBe(byId.b!.x);
    expect(byId.a!.y).not.toBe(byId.b!.y);
  });
});

describe('layoutIfNeeded / store integration', () => {
  it('layoutIfNeeded leaves an already-arranged graph untouched', () => {
    const laid = applyLayout(chain());
    expect(layoutIfNeeded(laid)).toEqual(laid);
  });

  it('a store constructed from a {0,0} graph auto-lays-out on load', () => {
    const store = new EditorStore(chain());
    const keys = store.current.nodes.map((n) => `${n.position.x},${n.position.y}`);
    expect(new Set(keys).size).toBe(keys.length); // no overlaps
  });

  it('replaceGraph also auto-lays-out', () => {
    const store = new EditorStore();
    store.replaceGraph(chain());
    const keys = store.current.nodes.map((n) => `${n.position.x},${n.position.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
