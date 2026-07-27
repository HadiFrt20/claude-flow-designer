import { describe, it, expect } from 'vitest';
import { registeredRuleIds } from '../src/validate.js';
import { readFileSync } from 'node:fs';

// Doc <-> code parity: every CFxxx in SPEC-VALIDATION.md must be registered, and vice versa.
describe('validation matrix', () => {
  it('every documented rule is registered (fill in during M0)', () => {
    const spec = readFileSync(new URL('../../../docs/SPEC-VALIDATION.md', import.meta.url), 'utf8');
    const documented = [...new Set(spec.match(/CF\d{3}/g) ?? [])].sort();
    const registered = [...registeredRuleIds()].sort();
    // M0 exit criterion: flip this to a strict deep-equal once rules are implemented.
    expect(documented.length).toBeGreaterThan(30);
    expect(registered.every(id => documented.includes(id))).toBe(true);
  });
});
