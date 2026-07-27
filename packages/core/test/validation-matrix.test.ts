import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ALL_RULES } from '../src/rules/index.js';
import { registeredRuleIds } from '../src/validate.js';
import type { RuleId, Severity } from '../src/validate.js';
import { fixtures } from './fixtures.js';

// Parse the rule catalog tables in SPEC-VALIDATION.md. Each row is:
//   | CFxxx | <severity> | <rule> | <quick fix?> |
const spec = readFileSync(new URL('../../../docs/SPEC-VALIDATION.md', import.meta.url), 'utf8');

const documented = new Map<string, Severity>();
for (const line of spec.split('\n')) {
  const m = /^\|\s*(CF\d{3})\s*\|\s*(error|warn|info)\s*\|/.exec(line);
  if (m) documented.set(m[1]!, m[2] as Severity);
}

const registered = new Map<string, Severity>(ALL_RULES.map((r) => [r.id, r.severity]));

describe('validation matrix: strict doc <-> code parity', () => {
  it('every documented rule id is registered and vice versa (exact set equality)', () => {
    const docIds = [...documented.keys()].sort();
    const codeIds = [...registeredRuleIds()].sort();
    expect(codeIds).toEqual(docIds);
  });

  it('the catalog documents 44 rules', () => {
    expect(documented.size).toBe(44);
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
});
