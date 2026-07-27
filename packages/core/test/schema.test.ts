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
import { fixtures } from './fixtures.js';

describe('WorkflowGraph schema', () => {
  it('parses a minimal graph', () => {
    const graph = emptyGraph('My Flow', 'my-flow');
    expect(parseGraph(graph)).toEqual(graph);
  });

  it('rejects a wrong version', () => {
    const bad = { ...emptyGraph('x', 'x'), version: 2 };
    expect(safeParseGraph(bad).success).toBe(false);
  });

  it('rejects an unknown node kind', () => {
    const bad = {
      ...emptyGraph('x', 'x'),
      nodes: [{ id: 'a', kind: 'trigger.telepathy', label: 'x', position: { x: 0, y: 0 }, data: {} }],
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

  it('validates a placeholder $N', () => {
    const node = {
      id: 'c', kind: 'trigger.slashCommand', label: 'c', position: { x: 0, y: 0 },
      data: { name: 'x', description: 'd', args: [{ name: 'a', placeholder: '$0' }] },
    };
    expect(workflowNodeSchema.safeParse(node).success).toBe(true);
    const badPlaceholder = { ...node, data: { ...node.data, args: [{ name: 'a', placeholder: '$x' }] } };
    expect(workflowNodeSchema.safeParse(badPlaceholder).success).toBe(false);
  });

  it('exposes the top-level schema for host consumers', () => {
    expect(workflowGraphSchema.safeParse(emptyGraph('a', 'a')).success).toBe(true);
  });
});
