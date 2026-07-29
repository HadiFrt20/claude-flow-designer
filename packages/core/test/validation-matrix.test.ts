import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ALL_RULES } from '../src/rules/index.js';
import { registeredRuleIds, validateGraph } from '../src/validate.js';
import type { RuleId, Severity } from '../src/validate.js';
import { fixtures } from './fixtures.js';

// Parse the rule catalog tables in SPEC-VALIDATION.md. Each row is:
//   | CFxxx | <severity> | <rule> | <quick fix> |
const spec = readFileSync(new URL('../../../docs/SPEC-VALIDATION.md', import.meta.url), 'utf8');

const NO_QUICK_FIX = new Set(['', '—', '-']); // "", em-dash, hyphen

const documented = new Map<string, Severity>();
// Rules whose catalog row names a quick fix (4th column is neither empty nor "—").
const documentedQuickFix = new Set<string>();

function cellsOf(line: string): string[] {
  // Escaped pipes (\|) only appear in the rule-description column; swap them for a
  // placeholder so they don't split cells, then split on real pipes and restore.
  const PH = '❘'; // light vertical bar — not used anywhere in the doc
  return line
    .replace(/\\\|/g, PH)
    .split('|')
    .map((c) => c.split(PH).join('|').trim());
}

for (const line of spec.split('\n')) {
  if (!/^\|\s*CF\d{3}\s*\|/.test(line)) continue;
  const cells = cellsOf(line); // ["", id, sev, rule, quickfix, ""]
  const id = cells[1];
  const sev = cells[2];
  const quickFix = cells[4] ?? '';
  if (!id || !/^CF\d{3}$/.test(id)) continue;
  if (sev !== 'error' && sev !== 'warn' && sev !== 'info') continue;
  documented.set(id, sev);
  if (!NO_QUICK_FIX.has(quickFix)) documentedQuickFix.add(id);
}

const registered = new Map<string, Severity>(ALL_RULES.map((r) => [r.id, r.severity]));

describe('validation matrix: strict doc <-> code parity', () => {
  it('every documented rule id is registered and vice versa (exact set equality)', () => {
    const docIds = [...documented.keys()].sort();
    const codeIds = [...registeredRuleIds()].sort();
    expect(codeIds).toEqual(docIds);
  });

  it('the catalog documents 20 rules', () => {
    expect(documented.size).toBe(20);
  });

  it('registered rule ids are unique', () => {
    const ids = registeredRuleIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('severity in code matches the Sev column in the doc for every rule', () => {
    const mismatches: string[] = [];
    for (const [id, sev] of documented) {
      const code = registered.get(id);
      if (code !== sev) mismatches.push(`${id}: doc=${sev} code=${code}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('every rule has both a hit and a miss fixture', () => {
    const missing: string[] = [];
    for (const id of documented.keys() as Iterable<RuleId>) {
      if (!fixtures[id]?.hit) missing.push(`${id}:hit`);
      if (!fixtures[id]?.miss) missing.push(`${id}:miss`);
    }
    expect(missing).toEqual([]);
  });

  it('every rule whose catalog row names a quick fix emits one on its hit fixture', () => {
    // This is what makes the matrix strict: a "Quick fix" cell in the doc that is
    // not backed by a real quickFix in code (or vice versa) fails CI.
    const missing: string[] = [];
    const unexpected: string[] = [];
    for (const id of documented.keys() as Iterable<RuleId>) {
      const emitsQuickFix = validateGraph(fixtures[id].hit).some(
        (d) => d.ruleId === id && d.quickFix !== undefined,
      );
      if (documentedQuickFix.has(id) && !emitsQuickFix) missing.push(id);
      if (!documentedQuickFix.has(id) && emitsQuickFix) unexpected.push(id);
    }
    expect({ missing, unexpected }).toEqual({ missing: [], unexpected: [] });
  });
});
