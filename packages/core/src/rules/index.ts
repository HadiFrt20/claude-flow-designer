// Registry assembly. ALL_RULES is ordered by RuleId (CF0xx → CF6xx) so
// validateGraph output is deterministic. Doc<->code parity is enforced by
// test/validation-matrix.test.ts.
import type { Rule } from '../diagnostics.js';
import { graphStructureRules } from './graph-structure.js';
import { workflowRules } from './workflow.js';

export const ALL_RULES: Rule[] = [...graphStructureRules, ...workflowRules];
