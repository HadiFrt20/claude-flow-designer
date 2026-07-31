// Source of truth: docs/SPEC-NODES.md / docs/SPEC-VALIDATION.md. Keep in lockstep.

/** A file emitted by codegen, relative to the project root. */
export interface GeneratedFile {
  path: string; // e.g. ".claude/workflows/audit-routes.js"
  content: string;
  executable?: boolean; // chmod +x (e.g. run scripts); workflow .js are not executable
}

/** Stable diagnostic identifiers — documented in docs/SPEC-VALIDATION.md, never renumber. */
export type RuleId =
  // graph structure (retargeted for the workflow DAG; CF007 retired)
  | 'CF001' | 'CF002' | 'CF003' | 'CF004' | 'CF005' | 'CF006' | 'CF008'
  // workflow script
  | 'CF601' | 'CF602' | 'CF604' | 'CF605' | 'CF606' | 'CF607' | 'CF608'
  | 'CF609' | 'CF610' | 'CF611' | 'CF613' | 'CF614' | 'CF615' | 'CF616'
  | 'CF617' | 'CF618' | 'CF619';
