import { describe, it, expect } from 'vitest';
import { isImportablePath, shouldDescend } from '../src/read-project.js';

describe('isImportablePath', () => {
  const yes = [
    'audit-routes.clauflow.json',
    '.claude/audit-routes.clauflow.json',
  ];
  const no = [
    'README.md',
    'src/index.ts',
    '.claude/workflows/audit-routes.js', // emitted script is one-way output
    'package.json',
  ];
  for (const p of yes) it(`imports ${p}`, () => expect(isImportablePath(p)).toBe(true));
  for (const p of no) it(`skips ${p}`, () => expect(isImportablePath(p)).toBe(false));
});

describe('shouldDescend', () => {
  it('descends root and .claude subtree only', () => {
    expect(shouldDescend('')).toBe(true);
    expect(shouldDescend('.claude')).toBe(true);
    expect(shouldDescend('.claude/workflows')).toBe(true);
    expect(shouldDescend('node_modules')).toBe(false);
    expect(shouldDescend('src')).toBe(false);
    expect(shouldDescend('.git')).toBe(false);
  });
});
