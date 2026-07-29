import { describe, it, expect } from 'vitest';
import {
  parseGraph,
  safeParseGraph,
  parseGraphJson,
  serializeGraph,
  emptyGraph,
  workflowGraphSchema,
} from '../src/schema/graph.js';
import { workflowNodeSchema, NODE_KINDS } from '../src/schema/nodes.js';
import { fixtures, valid } from './fixtures.js';

describe('WorkflowGraph schema', () => {
  it('parses a minimal (empty) graph', () => {
    const graph = emptyGraph('My Flow', 'my-flow');
    expect(parseGraph(graph)).toEqual(graph);
  });

  it('parses a full valid workflow', () => {
    const graph = valid();
    expect(parseGraph(graph)).toEqual(graph);
  });

  it('rejects a wrong version', () => {
    const bad = { ...emptyGraph('x', 'x'), version: 2 };
    expect(safeParseGraph(bad).success).toBe(false);
  });

  it('rejects an unknown node kind', () => {
    const bad = {
      ...emptyGraph('x', 'x'),
      nodes: [{ id: 'a', kind: 'agent.telepathy', label: 'x', position: { x: 0, y: 0 }, data: {} }],
    };
    expect(safeParseGraph(bad).success).toBe(false);
  });

  it('serialize → parse round-trips every fixture graph', () => {
    for (const { hit, miss } of Object.values(fixtures)) {
      for (const graph of [hit, miss]) {
        const json = serializeGraph(graph);
        expect(json.endsWith('\n')).toBe(true);
        expect(parseGraphJson(json)).toEqual(graph);
      }
    }
  });

  it('the node union covers exactly the declared NODE_KINDS', () => {
    const unionKinds = workflowNodeSchema.options
      .map((o) => o.shape.kind.value)
      .sort();
    expect(unionKinds).toEqual([...NODE_KINDS].sort());
  });

  it('applies schema defaults on optional fields', () => {
    // return.transform defaults to 'none'; loop.passField to 'passed', maxRounds to 2.
    const ret = workflowNodeSchema.parse({
      id: 'r', kind: 'output.return', label: 'r', position: { x: 0, y: 0 }, data: { source: 'a' },
    });
    if (ret.kind !== 'output.return') throw new Error('kind');
    expect(ret.data.transform).toBe('none');

    const loop = workflowNodeSchema.parse({
      id: 'l', kind: 'loopUntilCheck', label: 'l', position: { x: 0, y: 0 },
      data: { checkPrompt: 'c', fixPrompt: 'f' },
    });
    if (loop.kind !== 'loopUntilCheck') throw new Error('kind');
    expect(loop.data.passField).toBe('passed');
    expect(loop.data.maxRounds).toBe(2);
  });

  it('rejects a fieldPath that is not a dotted identifier', () => {
    const bad = {
      id: 'r', kind: 'output.return', label: 'r', position: { x: 0, y: 0 },
      data: { source: 'a', field: '1bad-field' },
    };
    expect(workflowNodeSchema.safeParse(bad).success).toBe(false);
  });

  it('exposes the top-level schema for host consumers', () => {
    expect(workflowGraphSchema.safeParse(emptyGraph('a', 'a')).success).toBe(true);
  });
});
