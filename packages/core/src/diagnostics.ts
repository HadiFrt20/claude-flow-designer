// Core diagnostic types shared by the rule engine and all rule modules.
// Kept separate from validate.ts to avoid a validate <-> rules import cycle.
import type { RuleId } from './schema/types.js';
import type { WorkflowGraph } from './schema/graph.js';

export type Severity = 'error' | 'warn' | 'info';

/** A machine-applicable graph transform, surfaced as a button in the problems panel. */
export interface QuickFix {
  title: string;
  apply(graph: WorkflowGraph): WorkflowGraph;
}

export interface Diagnostic {
  ruleId: RuleId;
  severity: Severity;
  nodeId?: string; // omit for graph-level
  field?: string; // property-panel highlight target
  message: string;
  quickFix?: QuickFix;
  docsUrl?: string;
}

/** A validation rule: pure function from graph to zero or more diagnostics. */
export interface Rule {
  id: RuleId;
  severity: Severity;
  run(graph: WorkflowGraph): Diagnostic[];
}
