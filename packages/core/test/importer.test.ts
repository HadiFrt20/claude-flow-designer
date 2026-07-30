import { describe, it, expect } from 'vitest';
import { parseProject } from '../src/importer.js';
import { generate } from '../src/codegen/index.js';
import { TEMPLATES } from '../src/templates.js';
import type { GeneratedFile } from '../src/schema/types.js';

// M7 (SPEC-CODEGEN "Importer"): a <slug>.clauflow.json sidecar round-trips exactly
// and wins; otherwise the emitted .claude/workflows/<slug>.js is PARSED back into a
// graph (real workflows are authored as .js and never ship a sidecar).
const file = (path: string, content: string): GeneratedFile => ({ path, content });

describe('parseProject sidecar round-trip', () => {
  it('uses the <slug>.clauflow.json sidecar verbatim when present', () => {
    for (const t of TEMPLATES) {
      const graph = parseProject(generate(t.graph));
      expect(graph).toEqual(t.graph);
    }
  });
});

describe('parseProject from the emitted .js (no sidecar)', () => {
  it('parses the emitted workflow script back into an equivalent graph', () => {
    // generate() emits .js + sidecar; drop the sidecar so only the .js is left.
    const t = TEMPLATES[0]!;
    const js = generate(t.graph).find((f) => f.path.endsWith('.js'))!;
    const graph = parseProject([js]);
    expect(graph).not.toBeNull();
    // The parsed graph re-generates byte-identical to the original script.
    const regen = generate(graph!).find((f) => f.path.endsWith('.js'))!;
    expect(regen.content).toBe(js.content);
  });

  it('returns null for an empty project', () => {
    expect(parseProject([])).toBeNull();
  });

  it('returns null for a .js that is not a workflow (no export const meta)', () => {
    expect(parseProject([file('README.md', '# hi\n'), file('.claude/workflows/x.js', '// nope\n')])).toBeNull();
  });
});
