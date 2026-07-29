import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildZip, zipBuffer, toDirEntries } from '../src/export-zip.js';
import { generate, TEMPLATES } from '@clauflow/core';
import type { GeneratedFile } from '@clauflow/core';

describe('buildZip / zipBuffer', () => {
  it('round-trips every generated file byte-identically through the zip', async () => {
    const files = generate(TEMPLATES.find((t) => t.slug === 'audit-routes')!.graph);
    const bytes = await zipBuffer(files);
    const back = await JSZip.loadAsync(bytes);
    for (const f of files) {
      const entry = back.file(f.path);
      expect(entry, `missing ${f.path} in zip`).not.toBeNull();
      expect(await entry!.async('string')).toBe(f.content);
    }
  });

  it('preserves the 0755 exec bit through a serialize → extract round-trip', async () => {
    const files: GeneratedFile[] = [
      { path: '.claude/hooks/x.sh', content: '#!/bin/bash\n', executable: true },
      { path: '.claude/settings.json', content: '{}\n' },
    ];
    // Round-trip through generateAsync (platform:UNIX) + loadAsync — this is what
    // actually reaches the user, unlike the pre-serialization JSZip object.
    const back = await JSZip.loadAsync(await zipBuffer(files));
    const sh = back.file('.claude/hooks/x.sh')! as unknown as { unixPermissions: number };
    const json = back.file('.claude/settings.json')! as unknown as { unixPermissions: number | null };
    expect(sh.unixPermissions & 0o777).toBe(0o755);
    // A non-executable file must NOT carry the exec bit.
    expect((json.unixPermissions ?? 0) & 0o111).toBe(0);
  });

  it('buildZip refuses an unsafe path (zip writer honors the same check as the dir writer)', () => {
    expect(() => buildZip([{ path: '.claude/../../escape.txt', content: 'x' }])).toThrow(/unsafe/);
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
    expect(() => toDirEntries([{ path: '.claude/../../x', content: 'x' }])).toThrow(/unsafe/);
  });

  it('refuses empty segments and backslash separators', () => {
    expect(() => toDirEntries([{ path: 'a//b.txt', content: 'x' }])).toThrow(/unsafe/);
    expect(() => toDirEntries([{ path: '.claude\\hooks\\x.sh', content: 'x' }])).toThrow(/unsafe/);
  });

  it('accepts the full template output', () => {
    const files = generate(TEMPLATES[0]!.graph);
    expect(() => toDirEntries(files)).not.toThrow();
    expect(toDirEntries(files)).toHaveLength(files.length);
  });
});
