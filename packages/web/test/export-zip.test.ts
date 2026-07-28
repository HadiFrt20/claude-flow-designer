import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildZip, zipBuffer, toDirEntries } from '../src/export-zip.js';
import { generate, TEMPLATES } from '@clauflow/core';
import type { GeneratedFile } from '@clauflow/core';

describe('buildZip / zipBuffer', () => {
  it('round-trips every generated file byte-identically through the zip', async () => {
    const files = generate(TEMPLATES.find((t) => t.slug === 'security-gate')!.graph);
    const bytes = await zipBuffer(files);
    const back = await JSZip.loadAsync(bytes);
    for (const f of files) {
      const entry = back.file(f.path);
      expect(entry, `missing ${f.path} in zip`).not.toBeNull();
      expect(await entry!.async('string')).toBe(f.content);
    }
  });

  it('marks executable files with 0755 unix permissions', async () => {
    const files: GeneratedFile[] = [
      { path: '.claude/hooks/x.sh', content: '#!/bin/bash\n', executable: true },
      { path: '.claude/settings.json', content: '{}\n' },
    ];
    const zip = buildZip(files);
    // JSZip stores unixPermissions on the file object.
    const sh = zip.file('.claude/hooks/x.sh')!;
    const json = zip.file('.claude/settings.json')!;
    expect((sh as unknown as { unixPermissions: number }).unixPermissions).toBe(0o755);
    expect((json as unknown as { unixPermissions: number | null }).unixPermissions ?? null).toBeNull();
  });
});

describe('toDirEntries', () => {
  it('splits paths into directory segments + leaf', () => {
    const entries = toDirEntries([{ path: '.claude/skills/x/SKILL.md', content: 'a' }]);
    expect(entries[0]!.segments).toEqual(['.claude', 'skills', 'x', 'SKILL.md']);
  });

  it('refuses an absolute path', () => {
    expect(() => toDirEntries([{ path: '/etc/passwd', content: 'x' }])).toThrow(/unsafe/);
  });

  it('refuses a path with ..', () => {
    expect(() => toDirEntries([{ path: '../outside.txt', content: 'x' }])).toThrow(/unsafe/);
  });

  it('accepts the full template output', () => {
    const files = generate(TEMPLATES[0]!.graph);
    expect(() => toDirEntries(files)).not.toThrow();
    expect(toDirEntries(files)).toHaveLength(files.length);
  });
});
