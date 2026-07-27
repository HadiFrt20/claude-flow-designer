import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../src/codegen/index.js';
import { TEMPLATES } from '../src/templates.js';

// Byte-exact assertions: every generated file must equal its committed
// fixtures/<slug>/<path> copy. Committed fixtures are the ground truth (present
// in every Stryker sandbox), so any codegen mutation that changes a single byte
// of output makes toBe() fail — this is what actually kills string/structural
// mutants that toMatchSnapshot()/toContain() let survive.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const fixturesDir = join(repoRoot, 'fixtures');

describe('codegen output is byte-exact against committed fixtures', () => {
  for (const t of TEMPLATES) {
    it(`${t.slug}: every generated file matches its committed fixture exactly`, () => {
      const files = generate(t.graph);
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        const fixturePath = join(fixturesDir, t.slug, f.path);
        expect(existsSync(fixturePath), `missing fixture ${t.slug}/${f.path}`).toBe(true);
        expect(f.content, `content drift in ${t.slug}/${f.path}`).toBe(
          readFileSync(fixturePath, 'utf8'),
        );
      }
    });

    it(`${t.slug}: emits exactly the committed file set`, () => {
      const paths = generate(t.graph)
        .map((f) => f.path)
        .sort();
      // Cross-check: the committed fixture set has the same paths.
      expect(paths).toMatchSnapshot();
    });
  }
});
