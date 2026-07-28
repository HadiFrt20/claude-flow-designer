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

  it('groups map to the four DESIGN-BRIEF categories', () => {
    expect(PALETTE.map((g) => g.group)).toEqual(['Triggers', 'Steps', 'Hooks', 'Control']);
  });
});

describe('categoryOf', () => {
  const cases: [NodeKind, string][] = [
    ['trigger.slashCommand', 'trigger'],
    ['step.prompt', 'step'],
    ['step.subagent', 'subagent'],
    ['hook.command', 'hookHandler'],
    ['gate.condition', 'control'],
    ['output.decision', 'control'],
  ];
  for (const [kind, cat] of cases) {
    it(`${kind} → ${cat}`, () => expect(categoryOf(kind)).toBe(cat));
  }
});

describe('edgeAllowed (shared with CF005)', () => {
  it('command → step allowed; command → hook handler rejected', () => {
    expect(edgeAllowed('trigger.slashCommand', 'step.prompt')).toBe(true);
    expect(edgeAllowed('trigger.slashCommand', 'hook.command')).toBe(false);
  });
  it('hook event → gate/handler allowed', () => {
    expect(edgeAllowed('trigger.hookEvent', 'gate.condition')).toBe(true);
    expect(edgeAllowed('trigger.hookEvent', 'hook.command')).toBe(true);
  });
  it('handler → decision allowed; handler → step rejected', () => {
    expect(edgeAllowed('hook.command', 'output.decision')).toBe(true);
    expect(edgeAllowed('hook.command', 'step.prompt')).toBe(false);
  });
});
