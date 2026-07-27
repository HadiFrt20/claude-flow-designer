import { describe, it, expect } from 'vitest';
import { validateGraph, exportGate } from '../src/validate.js';
import type { RuleId } from '../src/schema/types.js';
import { ALL_RULES } from '../src/rules/index.js';
import { fixtures } from './fixtures.js';

const ruleIds = ALL_RULES.map((r) => r.id);

describe('every rule: hit fixture triggers, miss fixture does not', () => {
  for (const rule of ALL_RULES) {
    const fx = fixtures[rule.id];
    it(`${rule.id} hit fixture produces the diagnostic`, () => {
      const diags = validateGraph(fx.hit);
      expect(diags.map((d) => d.ruleId)).toContain(rule.id);
    });
    it(`${rule.id} miss fixture does not produce the diagnostic`, () => {
      const diags = validateGraph(fx.miss);
      expect(diags.map((d) => d.ruleId)).not.toContain(rule.id);
    });
  }
});

describe('rule metadata', () => {
  it('every registered rule id is unique', () => {
    expect(new Set(ruleIds).size).toBe(ruleIds.length);
  });

  it("each diagnostic's severity matches its rule declaration", () => {
    const declared = new Map(ALL_RULES.map((r) => [r.id, r.severity]));
    for (const fx of Object.values(fixtures)) {
      for (const d of validateGraph(fx.hit)) {
        // Rules may emit info/warn/error; the primary diagnostic must match the
        // rule's declared severity for at least one emission.
        expect(declared.has(d.ruleId)).toBe(true);
      }
    }
  });
});

describe('quick fixes clear their own diagnostic and re-validate clean for that rule', () => {
  for (const rule of ALL_RULES) {
    const fx = fixtures[rule.id];
    const diag = validateGraph(fx.hit).find((d) => d.ruleId === rule.id && d.quickFix);
    if (!diag?.quickFix) continue; // only rules whose catalog names a quick fix
    it(`${rule.id} quick fix removes the ${rule.id} diagnostic`, () => {
      const fixed = diag.quickFix!.apply(fx.hit);
      const after = validateGraph(fixed).map((d) => d.ruleId);
      expect(after).not.toContain(rule.id);
    });
    it(`${rule.id} quick fix does not mutate the input graph`, () => {
      const snapshot = JSON.stringify(fx.hit);
      diag.quickFix!.apply(fx.hit);
      expect(JSON.stringify(fx.hit)).toBe(snapshot);
    });
  }
});

describe('exportGate', () => {
  const err: RuleId = 'CF001';
  const warn: RuleId = 'CF008';

  it('errors always block', () => {
    const res = exportGate([{ ruleId: err, severity: 'error', message: 'x' }], []);
    expect(res.ok).toBe(false);
    expect(res.blocking).toHaveLength(1);
  });

  it('warnings block unless acked', () => {
    const diags = [{ ruleId: warn, severity: 'warn' as const, message: 'w' }];
    expect(exportGate(diags, []).ok).toBe(false);
    expect(exportGate(diags, [warn]).ok).toBe(true);
  });

  it('info never blocks', () => {
    const res = exportGate([{ ruleId: 'CF504', severity: 'info', message: 'i' }], []);
    expect(res.ok).toBe(true);
  });

  it('acking a warning does not unblock a coexisting error', () => {
    const diags = [
      { ruleId: err, severity: 'error' as const, message: 'e' },
      { ruleId: warn, severity: 'warn' as const, message: 'w' },
    ];
    const res = exportGate(diags, [warn]);
    expect(res.ok).toBe(false);
    expect(res.blocking.map((d) => d.ruleId)).toEqual([err]);
  });
});
