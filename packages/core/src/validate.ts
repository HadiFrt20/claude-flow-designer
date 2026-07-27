// Rule engine per docs/SPEC-VALIDATION.md. Every RuleId in that doc must be registered
// here; test/validation-matrix.test.ts enforces doc<->code parity.
export type Severity = 'error' | 'warn' | 'info';

export type RuleId =
  // graph structure
  | 'CF001' | 'CF002' | 'CF003' | 'CF004' | 'CF005' | 'CF006' | 'CF007' | 'CF008'
  // hooks
  | 'CF101' | 'CF102' | 'CF103' | 'CF104' | 'CF105' | 'CF106' | 'CF107' | 'CF108'
  | 'CF109' | 'CF110' | 'CF111' | 'CF112' | 'CF113' | 'CF114' | 'CF115'
  // skills
  | 'CF201' | 'CF202' | 'CF203' | 'CF204' | 'CF205' | 'CF206' | 'CF207'
  // subagents
  | 'CF301' | 'CF302' | 'CF303'
  // settings/model/effort
  | 'CF401' | 'CF402' | 'CF403' | 'CF404' | 'CF405' | 'CF406' | 'CF407'
  // headless
  | 'CF501' | 'CF502' | 'CF503' | 'CF504';

export interface QuickFix<G = unknown> { title: string; apply(graph: G): G }

export interface Diagnostic {
  ruleId: RuleId;
  severity: Severity;
  nodeId?: string;
  field?: string;
  message: string;
  quickFix?: QuickFix;
  docsUrl?: string;
}

export type Rule<G = unknown> = { id: RuleId; run(graph: G): Diagnostic[] };

const registry: Rule[] = []; // M0: register all rules; keep in RuleId order.

export function registerRule(rule: Rule): void { registry.push(rule); }
export function registeredRuleIds(): RuleId[] { return registry.map(r => r.id); }

export function validateGraph<G>(graph: G): Diagnostic[] {
  return registry.flatMap(r => r.run(graph));
}

/** Export gate: errors always block; warnings block unless acked (meta.ackedWarnings). */
export function exportGate(diags: Diagnostic[], acked: RuleId[]): { ok: boolean; blocking: Diagnostic[] } {
  const blocking = diags.filter(d =>
    d.severity === 'error' || (d.severity === 'warn' && !acked.includes(d.ruleId)));
  return { ok: blocking.length === 0, blocking };
}
