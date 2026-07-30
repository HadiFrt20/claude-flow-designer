// parseProject(files) → WorkflowGraph. The round-trip counterpart of generate().
//
// M7 (SPEC-CODEGEN "Importer"): a `<slug>.clauflow.json` sidecar, if present, is
// the exact round-trip source of truth and wins. Otherwise we PARSE the emitted
// `.claude/workflows/<slug>.js` back into a graph (parseWorkflowJs) — real Claude
// Code workflows are authored as `.js` and never ship a sidecar. Returns null when
// neither a sidecar nor a parseable workflow script is present.
import type { GeneratedFile } from './schema/types.js';
import type { WorkflowGraph } from './schema/graph.js';
import { parseGraphJson } from './schema/graph.js';
import { parseWorkflowJs } from './import-js.js';

/** The `<slug>` of a `.claude/workflows/<slug>.js` path (for the graph slug). */
function slugOf(path: string): string {
  const m = path.match(/([^/]+)\.js$/);
  return m ? m[1]! : 'imported';
}

/**
 * Parse a set of project files into a WorkflowGraph, or null if none carries a
 * workflow. A `.clauflow.json` sidecar round-trips exactly; otherwise the first
 * `.claude/workflows/*.js` (or any `*.js` with an `export const meta`) is parsed.
 */
export function parseProject(files: GeneratedFile[]): WorkflowGraph | null {
  const sidecar = files.find((f) => f.path.endsWith('.clauflow.json'));
  if (sidecar) return parseGraphJson(sidecar.content);

  // Prefer a script under .claude/workflows/, else any .js.
  const js = files.find((f) => /\.claude\/workflows\/[^/]+\.js$/.test(f.path))
    ?? files.find((f) => f.path.endsWith('.js'));
  if (js) return parseWorkflowJs(js.content, slugOf(js.path));

  return null;
}
