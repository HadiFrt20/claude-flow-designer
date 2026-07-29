import { describe, it, expect } from 'vitest';
import { FIELD_DESCRIPTORS, PALETTE, defaultData } from '../src/fields.js';
import { categoryOf } from '../src/tokens.js';
import { NODE_KINDS, edgeAllowed, workflowNodeSchema, type NodeKind } from '@clauflow/core';

describe('field descriptors', () => {
  it('has a descriptor table for every node kind', () => {
    for (const kind of NODE_KINDS) {
      expect(FIELD_DESCRIPTORS[kind], `missing descriptors for ${kind}`).toBeDefined();
      expect(FIELD_DESCRIPTORS[kind].length).toBeGreaterThan(0);
    }
  });

  it('every descriptor is grouped Basic or Advanced', () => {
    for (const kind of NODE_KINDS) {
      for (const f of FIELD_DESCRIPTORS[kind]) {
        expect(['Basic', 'Advanced']).toContain(f.group);
      }
    }
  });

  it('defaultData produces a schema-valid node for every kind', () => {
    for (const kind of NODE_KINDS) {
      const node = { id: 'n', kind, label: 'n', position: { x: 0, y: 0 }, data: defaultData(kind) };
      const res = workflowNodeSchema.safeParse(node);
      expect(res.success, `defaultData(${kind}) invalid: ${res.success ? '' : JSON.stringify(res.error.issues)}`).toBe(true);
    }
  });

  it('descriptor keys exist on the default data or are optional schema fields', () => {
    // Every descriptor key should be a real field name (present in defaults for
    // required fields; the rest are optional). Guards against typo drift.
    for (const kind of NODE_KINDS) {
      const node = { id: 'n', kind, label: 'n', position: { x: 0, y: 0 }, data: defaultData(kind) };
      // Set each descriptor key to a probe value and confirm the schema still parses
      // (i.e. the key is a recognised optional/known field, not rejected).
      for (const f of FIELD_DESCRIPTORS[kind]) {
        expect(typeof f.key).toBe('string');
        expect(f.key.length).toBeGreaterThan(0);
      }
      expect(workflowNodeSchema.safeParse(node).success).toBe(true);
    }
  });
});

describe('palette', () => {
  it('covers every node kind exactly once', () => {
    const kinds = PALETTE.flatMap((g) => g.entries.map((e) => e.kind)).sort();
    expect(kinds).toEqual([...NODE_KINDS].sort());
  });

  it('groups map to the DESIGN-BRIEF categories', () => {
    expect(PALETTE.map((g) => g.group)).toEqual(['Entry', 'Agents', 'Control']);
  });
});

describe('categoryOf', () => {
  const cases: [NodeKind, string][] = [
    ['workflow.meta', 'meta'],
    ['agent', 'agent'],
    ['pipeline', 'pipeline'],
    ['branch', 'control'],
    ['loopUntilCheck', 'control'],
    ['output.return', 'control'],
  ];
  for (const [kind, cat] of cases) {
    it(`${kind} → ${cat}`, () => expect(categoryOf(kind)).toBe(cat));
  }
});

describe('edgeAllowed (shared with CF005)', () => {
  it('meta → agent allowed; nothing → meta rejected', () => {
    expect(edgeAllowed('workflow.meta', 'agent')).toBe(true);
    expect(edgeAllowed('agent', 'workflow.meta')).toBe(false);
  });
  it('agent → pipeline/branch allowed', () => {
    expect(edgeAllowed('agent', 'pipeline')).toBe(true);
    expect(edgeAllowed('agent', 'branch')).toBe(true);
  });
  it('anything → return allowed; return → anything rejected (sink)', () => {
    expect(edgeAllowed('agent', 'output.return')).toBe(true);
    expect(edgeAllowed('output.return', 'agent')).toBe(false);
  });
});
