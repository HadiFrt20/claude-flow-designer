// parseProject(files) → WorkflowGraph. The round-trip counterpart of generate().
//
// M6 decision (SPEC-CODEGEN "Importer"): the emitted .js is ONE-WAY output. The
// <slug>.clauflow.json sidecar is the single round-trip source of truth. We do NOT
// parse JavaScript back into a graph (it's a full language; lossy). If no sidecar
// is present, import returns null.
import type { GeneratedFile } from './schema/types.js';
import type { WorkflowGraph } from './schema/graph.js';
import { parseGraphJson } from './schema/graph.js';

/**
 * Parse a set of project files into a WorkflowGraph, or null if none carries a
 * `.clauflow.json` sidecar. `parseProject(generate(g))` deep-equals `g`.
 */
export function parseProject(files: GeneratedFile[]): WorkflowGraph | null {
  const sidecar = files.find((f) => f.path.endsWith('.clauflow.json'));
  return sidecar ? parseGraphJson(sidecar.content) : null;
}
