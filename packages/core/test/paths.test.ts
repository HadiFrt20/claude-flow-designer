import { describe, it, expect } from 'vitest';
import { isSafePath, safePathSegments } from '../src/codegen/paths.js';

describe('safePathSegments', () => {
  it('splits a safe relative path into segments', () => {
    expect(safePathSegments('.claude/skills/x/SKILL.md')).toEqual(['.claude', 'skills', 'x', 'SKILL.md']);
    expect(safePathSegments('run.sh')).toEqual(['run.sh']);
  });

  it('returns null for unsafe paths', () => {
    for (const p of ['', '/abs', '../up', 'a/../b', 'a//b', './x', 'a\\b', '.claude/../../x']) {
      expect(safePathSegments(p), p).toBeNull();
    }
  });
});

describe('isSafePath', () => {
  it('mirrors safePathSegments', () => {
    expect(isSafePath('.claude/settings.json')).toBe(true);
    expect(isSafePath('../escape')).toBe(false);
  });
});
