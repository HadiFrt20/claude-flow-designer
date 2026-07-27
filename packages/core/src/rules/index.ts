// Registry assembly. ALL_RULES is ordered by RuleId (CF001 → CF504) so
// validateGraph output is deterministic. Doc<->code parity is enforced by
// test/validation-matrix.test.ts.
import type { Rule } from '../diagnostics.js';
import { graphStructureRules } from './graph-structure.js';
import { hookRules } from './hooks.js';
import { skillRules } from './skills.js';
import { subagentRules } from './subagents.js';
import { settingsRules } from './settings.js';
import { headlessRules } from './headless.js';

export const ALL_RULES: Rule[] = [
  ...graphStructureRules,
  ...hookRules,
  ...skillRules,
  ...subagentRules,
  ...settingsRules,
  ...headlessRules,
];
