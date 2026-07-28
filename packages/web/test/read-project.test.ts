import { describe, it, expect } from 'vitest';
import { isImportablePath, shouldDescend } from '../src/read-project.js';

describe('isImportablePath', () => {
  const yes = [
    '.claude/skills/deploy/SKILL.md',
    '.claude/commands/lint.md',
    '.claude/agents/rev.md',
    '.claude/settings.json',
    '.claude/settings.local.json',
    'flow.clauflow.json',
    'run.sh',
  ];
  const no = [
    'README.md',
    '.claude/skills/deploy/notes.txt',
    'src/index.ts',
    '.claude/hooks/pretooluse-1.sh', // hook scripts are regenerated, not imported
    'package.json',
  ];
  for (const p of yes) it(`imports ${p}`, () => expect(isImportablePath(p)).toBe(true));
  for (const p of no) it(`skips ${p}`, () => expect(isImportablePath(p)).toBe(false));
});

describe('shouldDescend', () => {
  it('descends root and .claude subtree only', () => {
    expect(shouldDescend('')).toBe(true);
    expect(shouldDescend('.claude')).toBe(true);
    expect(shouldDescend('.claude/skills')).toBe(true);
    expect(shouldDescend('node_modules')).toBe(false);
    expect(shouldDescend('src')).toBe(false);
    expect(shouldDescend('.git')).toBe(false);
  });
});
