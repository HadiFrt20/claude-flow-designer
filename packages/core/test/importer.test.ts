import { describe, it, expect } from 'vitest';
import { parseProject } from '../src/importer.js';
import { generate } from '../src/codegen/index.js';
import { TEMPLATES } from '../src/templates.js';
import type { GeneratedFile } from '../src/schema/types.js';

// M6 decision (SPEC-CODEGEN "Importer"): the emitted .js is ONE-WAY output; the
// <slug>.clauflow.json sidecar is the single round-trip source of truth. We do
// NOT parse JavaScript back into a graph. parseProject returns null with no sidecar.
const file = (path: string, content: string): GeneratedFile => ({ path, content });

describe('parseProject sidecar round-trip', () => {
  it('uses the <slug>.clauflow.json sidecar verbatim when present', () => {
    for (const t of TEMPLATES) {
      const graph = parseProject(generate(t.graph));
      expect(graph).toEqual(t.graph);
    }
  });
});

describe('parseProject with no sidecar', () => {
  it('returns null for an empty project', () => {
    expect(parseProject([])).toBeNull();
  });

  it('returns null for a project that has only the emitted .js (one-way output)', () => {
    const js = generate(TEMPLATES[0]!.graph).find((f) => f.path.endsWith('.js'))!;
    expect(parseProject([js])).toBeNull();
  });

  it('returns null for unrelated files', () => {
    expect(parseProject([file('README.md', '# hi\n'), file('.claude/workflows/x.js', '// nope\n')])).toBeNull();
  });
});
