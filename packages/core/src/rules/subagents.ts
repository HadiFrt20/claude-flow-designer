// Subagent rules CF301–CF303. See docs/SPEC-VALIDATION.md ("Subagents").
import type { Diagnostic, Rule } from '../diagnostics.js';
import { nodesOfKind } from '../schema/graph-utils.js';
import { DOCS_URLS } from './helpers.js';

// CF301 — subagent tools include a tool not in the workflow's allow set.
const cf301: Rule = {
  id: 'CF301',
  severity: 'error',
  run(graph) {
    const allow = graph.settings.permissions?.allow;
    // Only enforce when the workflow declares an allow set (otherwise "inherit all").
    if (!allow || allow.length === 0) return [];
    // The base tool name of an allow rule, e.g. "Bash(git *)" → "Bash".
    const allowedBases = new Set(allow.map((r) => r.split('(')[0]!.trim()));
    const diags: Diagnostic[] = [];
    for (const a of nodesOfKind(graph, 'step.subagent')) {
      for (const tool of a.data.tools ?? []) {
        const base = tool.split('(')[0]!.trim();
        if (!allowedBases.has(base)) {
          diags.push({
            ruleId: 'CF301',
            severity: 'error',
            nodeId: a.id,
            field: 'tools',
            message: `Subagent tool "${tool}" is not in the workflow allow set.`,
            docsUrl: DOCS_URLS.subAgents,
          });
        }
      }
    }
    return diags;
  },
};

// CF302 — subagent without description (Claude can't auto-delegate).
const cf302: Rule = {
  id: 'CF302',
  severity: 'warn',
  run(graph) {
    return nodesOfKind(graph, 'step.subagent')
      .filter((a) => !(a.data.description ?? '').trim())
      .map(
        (a): Diagnostic => ({
          ruleId: 'CF302',
          severity: 'warn',
          nodeId: a.id,
          field: 'description',
          message: 'Subagent has no description; Claude cannot auto-delegate to it.',
          docsUrl: DOCS_URLS.subAgents,
        }),
      );
  },
};

// CF303 — Stop hook in agent frontmatter (auto-converted to SubagentStop — inform).
const cf303: Rule = {
  id: 'CF303',
  severity: 'warn',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const a of nodesOfKind(graph, 'step.subagent')) {
      if ((a.data.frontmatterHooks ?? []).includes('Stop')) {
        diags.push({
          ruleId: 'CF303',
          severity: 'warn',
          nodeId: a.id,
          field: 'frontmatterHooks',
          message: 'A "Stop" hook in agent frontmatter is auto-converted to "SubagentStop".',
          docsUrl: DOCS_URLS.subAgents,
        });
      }
    }
    return diags;
  },
};

export const subagentRules: Rule[] = [cf301, cf302, cf303];
