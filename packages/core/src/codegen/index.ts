// generate(graph) → GeneratedFile[]. Pipeline order (SPEC-CODEGEN, brief M1):
//   validateGraph → exportGate → emit → self-lint → files.
// Refuses to emit on blocking diagnostics; self-lint throws on any bad artifact.
import type { GeneratedFile } from '../schema/types.js';
import type { WorkflowGraph } from '../schema/graph.js';
import { validateGraph, exportGate } from '../validate.js';
import { serializeGraph } from '../schema/graph.js';
import { buildWorkflow } from './workflow.js';
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
  /**
   * Gate on ERRORS only, ignoring unacknowledged warnings. Default false (the export/
   * write path: warnings block until acked). The live PREVIEW passes true — a readability
   * warning (e.g. CF614 missing itemLabel) should never hide the read-only generated
   * output, especially for an imported workflow the user is just visualizing. Errors
   * still block (they'd emit invalid JS); self-lint still runs.
   */
  ignoreWarnings?: boolean;
}

function sortFiles(files: GeneratedFile[]): GeneratedFile[] {
  return [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Generate the full output for a graph. Throws ExportGateError if validation
 * blocks, or SelfLintError if an emitted artifact is malformed (a codegen bug).
 */
export function generate(graph: WorkflowGraph, opts: GenerateOptions = {}): GeneratedFile[] {
  const { includeGraphFile = true, ignoreWarnings = false } = opts;

  // 1. validate + 2. export gate. The preview (ignoreWarnings) gates on errors only;
  // the export/write path treats unacked warnings as blocking (acked in the dialog).
  const diags = validateGraph(graph);
  const acked = graph.meta.ackedWarnings ?? [];
  const gate = ignoreWarnings
    ? exportGate(diags.filter((d) => d.severity === 'error'), acked)
    : exportGate(diags, acked);
  if (!gate.ok) throw new ExportGateError(gate.blocking);

  // 3. emit — the workflow script (with exact raw byte spans) + round-trip sidecar.
  const built = buildWorkflow(graph);
  const files: GeneratedFile[] = [built.file];
  if (includeGraphFile) {
    files.push({ path: `${graph.meta.slug}.clauflow.json`, content: serializeGraph(graph) });
  }

  // 4. self-lint (throws on any malformed artifact) + deterministic ordering.
  // Raw-node code is opaque verbatim user JS — the emitter records its exact byte
  // ranges (accurate even for identical/indented raw blocks; B3/B4), and self-lint
  // exempts identifiers inside them from the undefined-identifier check.
  const rawRegionsByPath = new Map<string, { start: number; end: number }[]>([[built.file.path, built.rawRegions]]);
  const ordered = sortFiles(files);
  selfLint(ordered, rawRegionsByPath);
  return ordered;
}

export { ExportGateError as GenerateExportGateError };
export { SelfLintError } from './self-lint.js';
