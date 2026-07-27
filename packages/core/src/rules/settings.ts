// Settings / model / effort rules CF401–CF407. See docs/SPEC-VALIDATION.md.
import type { Diagnostic, Rule } from '../diagnostics.js';
import type { WorkflowGraph } from '../schema/graph.js';
import { patchSettings } from './quickfix-utils.js';
import { DOCS_URLS, KNOWN_MODELS, isHaiku } from './helpers.js';

// Reserved / special env-var prefixes (REFERENCE: env vars).
const VALID_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// CF401 — effort xhigh|max targeted at settings.json (flaky).
const cf401: Rule = {
  id: 'CF401',
  severity: 'warn',
  run(graph) {
    const e = graph.settings.effort;
    if (e === 'xhigh' || e === 'max') {
      return [
        {
          ruleId: 'CF401',
          severity: 'warn',
          field: 'effort',
          message: `effort "${e}" is unreliable in settings.json (issues #30726/#45453); codegen emits it as a --effort CLI flag instead.`,
          docsUrl: DOCS_URLS.modelConfig,
          quickFix: {
            title: 'Move effort to a headless CLI flag',
            apply: (g: WorkflowGraph) =>
              patchSettings(g, (s) => {
                s.headless = { ...(s.headless ?? { enabled: true }), enabled: true };
              }),
          },
        },
      ];
    }
    return [];
  },
};

// CF402 — Haiku + xhigh/max effort (wasteful pairing).
const cf402: Rule = {
  id: 'CF402',
  severity: 'warn',
  run(graph) {
    const { model, effort } = graph.settings;
    if (isHaiku(model) && (effort === 'xhigh' || effort === 'max')) {
      return [
        {
          ruleId: 'CF402',
          severity: 'warn',
          field: 'effort',
          message: `Haiku + "${effort}" effort is a wasteful pairing; pick a larger model or lower effort.`,
          docsUrl: DOCS_URLS.modelConfig,
        },
      ];
    }
    return [];
  },
};

// CF403 — unknown model string.
const cf403: Rule = {
  id: 'CF403',
  severity: 'error',
  run(graph) {
    const model = graph.settings.model;
    if (model && !KNOWN_MODELS.has(model)) {
      return [
        {
          ruleId: 'CF403',
          severity: 'error',
          field: 'model',
          message: `Unknown model "${model}" (not a known alias or ID).`,
          docsUrl: DOCS_URLS.modelConfig,
        },
      ];
    }
    return [];
  },
};

// CF404 — bypassPermissions mode in an exported workflow (require ack).
const cf404: Rule = {
  id: 'CF404',
  severity: 'warn',
  run(graph) {
    if (graph.settings.permissionMode === 'bypassPermissions') {
      return [
        {
          ruleId: 'CF404',
          severity: 'warn',
          field: 'permissionMode',
          message: 'bypassPermissions mode disables all permission prompts; acknowledge before exporting.',
          docsUrl: DOCS_URLS.permissions,
        },
      ];
    }
    return [];
  },
};

// Very small permission-rule syntax check (CF405). A rule is `Tool` or `Tool(pattern)`
// with balanced parens and a non-empty tool name.
function permissionRuleValid(rule: string): boolean {
  const trimmed = rule.trim();
  if (trimmed === '') return false;
  const m = /^([A-Za-z][A-Za-z0-9_]*)(\((.*)\))?$/.exec(trimmed);
  if (!m) return false;
  // If it has parens, the inner pattern must be non-empty.
  if (m[2] !== undefined && (m[3] ?? '').trim() === '') return false;
  return true;
}

// CF405 — permission rule syntax invalid.
const cf405: Rule = {
  id: 'CF405',
  severity: 'error',
  run(graph) {
    const p = graph.settings.permissions;
    if (!p) return [];
    const diags: Diagnostic[] = [];
    for (const [bucket, rules] of Object.entries(p) as [keyof typeof p, string[]][]) {
      for (const r of rules) {
        if (!permissionRuleValid(r)) {
          diags.push({
            ruleId: 'CF405',
            severity: 'error',
            field: `permissions.${bucket}`,
            message: `Invalid permission rule syntax: "${r}".`,
            docsUrl: DOCS_URLS.permissions,
          });
        }
      }
    }
    return diags;
  },
};

// CF406 — deny rule shadowed by a broader allow (allow/deny precedence explainer).
// deny wins in Claude Code, so a deny "shadowed" by allow is actually the safe
// case; the catalog flags the confusing pairing where an allow rule is a strict
// superset of a deny rule (user likely misunderstands precedence).
const cf406: Rule = {
  id: 'CF406',
  severity: 'warn',
  run(graph) {
    const p = graph.settings.permissions;
    if (!p) return [];
    const diags: Diagnostic[] = [];
    const base = (r: string) => r.split('(')[0]!.trim();
    for (const deny of p.deny) {
      for (const allow of p.allow) {
        // Same tool, allow is bare (covers everything) while deny is specific.
        if (base(allow) === base(deny) && !allow.includes('(') && deny.includes('(')) {
          diags.push({
            ruleId: 'CF406',
            severity: 'warn',
            field: 'permissions.deny',
            message: `deny "${deny}" overlaps a broader allow "${allow}". deny wins in Claude Code — confirm this is intended.`,
            docsUrl: DOCS_URLS.permissions,
          });
        }
      }
    }
    return diags;
  },
};

// CF407 — env var name invalid / reserved.
const cf407: Rule = {
  id: 'CF407',
  severity: 'error',
  run(graph) {
    const env = graph.settings.env;
    if (!env) return [];
    const diags: Diagnostic[] = [];
    for (const name of Object.keys(env)) {
      if (!VALID_ENV_NAME.test(name)) {
        diags.push({
          ruleId: 'CF407',
          severity: 'error',
          field: 'env',
          message: `Invalid env var name "${name}".`,
          docsUrl: DOCS_URLS.settings,
        });
      } else if (/^OTEL_/.test(name)) {
        diags.push({
          ruleId: 'CF407',
          severity: 'error',
          field: 'env',
          message: `env var "${name}" is stripped from subprocesses (OTEL_* reserved); rename it.`,
          docsUrl: DOCS_URLS.settings,
        });
      } else if (/^CLAUDE_/.test(name)) {
        diags.push({
          ruleId: 'CF407',
          severity: 'warn',
          field: 'env',
          message: `env var "${name}" uses the reserved CLAUDE_ prefix; may collide with Claude Code internals.`,
          docsUrl: DOCS_URLS.settings,
        });
      }
    }
    return diags;
  },
};

export const settingsRules: Rule[] = [
  cf401, cf402, cf403, cf404, cf405, cf406, cf407,
];
