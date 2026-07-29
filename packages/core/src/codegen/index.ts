// generate(graph) → GeneratedFile[]. Pipeline order (SPEC-CODEGEN, brief M1):
//   validateGraph → exportGate → emit → self-lint → files.
// Refuses to emit on blocking diagnostics; self-lint throws on any bad artifact.
import type { GeneratedFile } from '../schema/types.js';
import type { WorkflowGraph } from '../schema/graph.js';
import { validateGraph, exportGate } from '../validate.js';
import { serializeGraph } from '../schema/graph.js';
import { emitWorkflow } from './workflow.js';
import { selfLint } from './self-lint.js';

export class ExportGateError extends Error {
  constructor(readonly blocking: ReturnType<typeof validateGraph>) {
    super(
      `export gate refused to emit: ${blocking.length} blocking diagnostic(s): ` +
        blocking.map((d) => `${d.ruleId} ${d.message}`).join('; '),
    );
    this.name = 'ExportGateError';
  }
}

export interface GenerateOptions {
  /** Include the round-trippable graph sidecar (<slug>.clauflow.json). Default true. */
  includeGraphFile?: boolean;
}

function sortFiles(files: GeneratedFile[]): GeneratedFile[] {
  return [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Generate the full output for a graph. Throws ExportGateError if validation
 * blocks, or SelfLintError if an emitted artifact is malformed (a codegen bug).
 */
export function generate(graph: WorkflowGraph, opts: GenerateOptions = {}): GeneratedFile[] {
  const { includeGraphFile = true } = opts;

  // 1. validate + 2. export gate
  const diags = validateGraph(graph);
  const acked = graph.meta.ackedWarnings ?? [];
  const gate = exportGate(diags, acked);
  if (!gate.ok) throw new ExportGateError(gate.blocking);

  // 3. emit — the workflow script + the round-trip sidecar.
  const files: GeneratedFile[] = [emitWorkflow(graph)];
  if (includeGraphFile) {
    files.push({ path: `${graph.meta.slug}.clauflow.json`, content: serializeGraph(graph) });
  }

  // 4. self-lint (throws on any malformed artifact) + deterministic ordering.
  const ordered = sortFiles(files);
  selfLint(ordered);
  return ordered;
}

export { ExportGateError as GenerateExportGateError };
export { SelfLintError } from './self-lint.js';
