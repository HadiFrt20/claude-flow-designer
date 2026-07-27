// Regenerate the template-gallery fixtures under fixtures/<slug>/ from TEMPLATES.
// CI runs this then diffs fixtures/ against the committed copy (drift = fail).
// Run: npm run fixtures:regen  (from repo root; builds core first).
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATES } from '../dist/templates.js';
import { generate } from '../dist/codegen/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const fixturesDir = join(repoRoot, 'fixtures');

// Clean and rebuild the gallery deterministically.
if (existsSync(fixturesDir)) rmSync(fixturesDir, { recursive: true, force: true });

let fileCount = 0;
for (const t of TEMPLATES) {
  for (const f of generate(t.graph)) {
    const outPath = join(fixturesDir, t.slug, f.path);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, f.content);
    fileCount++;
  }
}

process.stdout.write(`fixtures:regen — wrote ${fileCount} files for ${TEMPLATES.length} templates\n`);
