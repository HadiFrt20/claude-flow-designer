// Headless / runner rules CF501–CF504. See docs/SPEC-VALIDATION.md ("Headless / runner").
import type { Diagnostic, Rule } from '../diagnostics.js';
import { nodesOfKind } from '../schema/graph-utils.js';
import { DOCS_URLS } from './helpers.js';

// CF501 — headless trigger without a prompt template.
const cf501: Rule = {
  id: 'CF501',
  severity: 'error',
  run(graph) {
    return nodesOfKind(graph, 'trigger.headless')
      .filter((n) => !n.data.promptTemplate.trim())
      .map(
        (n): Diagnostic => ({
          ruleId: 'CF501',
          severity: 'error',
          nodeId: n.id,
          field: 'promptTemplate',
          message: 'Headless trigger has no prompt template; `claude -p` needs a prompt.',
          docsUrl: DOCS_URLS.headless,
        }),
      );
  },
};

// CF502 — --output-format stream-json consumed by nothing downstream.
// In M0 there is no downstream consumer concept, so this fires whenever
// stream-json is selected (the runner just prints it). Info-adjacent warning.
const cf502: Rule = {
  id: 'CF502',
  severity: 'warn',
  run(graph) {
    const h = graph.settings.headless;
    if (h?.enabled && h.outputFormat === 'stream-json') {
      return [
        {
          ruleId: 'CF502',
          severity: 'warn',
          field: 'headless.outputFormat',
          message:
            '--output-format stream-json is emitted but nothing downstream consumes it; use text/json unless you pipe it.',
          docsUrl: DOCS_URLS.headless,
        },
      ];
    }
    return [];
  },
};

// CF503 — --max-turns low for a multi-step workflow (heuristic: < steps × 2).
const cf503: Rule = {
  id: 'CF503',
  severity: 'warn',
  run(graph) {
    const h = graph.settings.headless;
    if (!h?.enabled || h.maxTurns === undefined) return [];
    const stepCount = graph.nodes.filter((n) => n.kind.startsWith('step.')).length;
    const suggested = stepCount * 2;
    if (stepCount > 0 && h.maxTurns < suggested) {
      return [
        {
          ruleId: 'CF503',
          severity: 'warn',
          field: 'headless.maxTurns',
          message: `--max-turns ${h.maxTurns} is low for ${stepCount} steps (suggest ≥ ${suggested}).`,
          docsUrl: DOCS_URLS.headless,
        },
      ];
    }
    return [];
  },
};

// CF504 — worktree enabled → remind about WorktreeCreate hook interaction.
const cf504: Rule = {
  id: 'CF504',
  severity: 'info',
  run(graph) {
    if (graph.settings.headless?.worktree) {
      return [
        {
          ruleId: 'CF504',
          severity: 'info',
          field: 'headless.worktree',
          message: 'Worktree is enabled; remember any WorktreeCreate hook runs before the session starts (non-zero exit aborts).',
          docsUrl: DOCS_URLS.hooks,
        },
      ];
    }
    return [];
  },
};

export const headlessRules: Rule[] = [cf501, cf502, cf503, cf504];
