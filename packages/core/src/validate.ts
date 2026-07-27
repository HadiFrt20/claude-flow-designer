// Rule engine per docs/SPEC-VALIDATION.md. Every RuleId in that doc must be registered
// here; test/validation-matrix.test.ts enforces doc<->code parity.
import type { RuleId } from './schema/types.js';
import type { WorkflowGraph } from './schema/graph.js';
import type { Diagnostic, Rule } from './diagnostics.js';
import { ALL_RULES } from './rules/index.js';

export type { RuleId } from './schema/types.js';
export type { Severity, QuickFix, Diagnostic, Rule } from './diagnostics.js';

const registry: Rule[] = [...ALL_RULES];

/** Register an extra rule at runtime (mainly for tests). */
export function registerRule(rule: Rule): void {
  registry.push(rule);
}

export function registeredRuleIds(): RuleId[] {
  return registry.map((r) => r.id);
}

/** Run all registered rules against a graph, in RuleId order. */
export function validateGraph(graph: WorkflowGraph): Diagnostic[] {
  return registry.flatMap((r) => r.run(graph));
}

/**
 * Export gate: errors always block; warnings block unless acknowledged.
 * `info` diagnostics never block. Returns the blocking subset.
 */
export function exportGate(
  diags: Diagnostic[],
  acked: readonly RuleId[] = [],
): { ok: boolean; blocking: Diagnostic[] } {
  const ackedSet = new Set(acked);
  const blocking = diags.filter(
    (d) => d.severity === 'error' || (d.severity === 'warn' && !ackedSet.has(d.ruleId)),
  );
  return { ok: blocking.length === 0, blocking };
}
