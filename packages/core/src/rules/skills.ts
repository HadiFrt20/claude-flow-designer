// Skill / slash-command rules CF201–CF207. See docs/SPEC-VALIDATION.md ("Skills / commands").
import type { Diagnostic, Rule } from '../diagnostics.js';
import type { WorkflowGraph } from '../schema/graph.js';
import { nodesOfKind, successors, nodeById } from '../schema/graph-utils.js';
import { patchNodeData } from './quickfix-utils.js';
import { DOCS_URLS, bashRuleCovers, firstToken } from './helpers.js';

const SKILL_DESC_BUDGET = 200; // chars, per SPEC-VALIDATION CF204 guidance

// CF201 — positional placeholder $N used with no matching arg definition.
const cf201: Rule = {
  id: 'CF201',
  severity: 'error',
  run(graph) {
    const byId = nodeById(graph);
    const diags: Diagnostic[] = [];
    for (const cmd of nodesOfKind(graph, 'trigger.slashCommand')) {
      const defined = new Set((cmd.data.args ?? []).map((a) => a.placeholder));
      // Collect $0..$9 used across the command's connected prompt steps + hint.
      const used = new Set<string>();
      const scan = (text: string) => {
        for (const m of text.matchAll(/\$([0-9])/g)) used.add(`$${m[1]}`);
      };
      for (const succId of successors(graph, cmd.id)) {
        const n = byId.get(succId);
        if (n?.kind === 'step.prompt') scan(n.data.body);
        if (n?.kind === 'step.shell') scan(n.data.command);
      }
      for (const p of used) {
        if (!defined.has(p as '$0')) {
          diags.push({
            ruleId: 'CF201',
            severity: 'error',
            nodeId: cmd.id,
            field: 'args',
            message: `Positional placeholder ${p} used but no matching arg is defined.`,
            docsUrl: DOCS_URLS.skills,
            quickFix: {
              title: `Add arg for ${p}`,
              apply: (g: WorkflowGraph) =>
                patchNodeData(g, cmd.id, 'trigger.slashCommand', (d) => {
                  d.args = [
                    ...(d.args ?? []),
                    { name: `arg${p.slice(1)}`, placeholder: p as '$0' },
                  ];
                }),
            },
          });
        }
      }
    }
    return diags;
  },
};

// CF202 — argument-hint missing while args are used.
const cf202: Rule = {
  id: 'CF202',
  severity: 'warn',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const cmd of nodesOfKind(graph, 'trigger.slashCommand')) {
      const hasArgs = (cmd.data.args?.length ?? 0) > 0;
      if (hasArgs && !cmd.data.argumentHint) {
        diags.push({
          ruleId: 'CF202',
          severity: 'warn',
          nodeId: cmd.id,
          field: 'argumentHint',
          message: 'Command uses args but has no argument-hint.',
          docsUrl: DOCS_URLS.skills,
          quickFix: {
            title: 'Generate an argument-hint',
            apply: (g: WorkflowGraph) =>
              patchNodeData(g, cmd.id, 'trigger.slashCommand', (d) => {
                d.argumentHint = (d.args ?? []).map((a) => `[${a.name}]`).join(' ');
              }),
          },
        });
      }
    }
    return diags;
  },
};

// CF203 — embedded !`cmd` not covered by an allowed-tools Bash rule.
// The command's allowed-tools is the union of tools required by connected steps;
// at graph level we approximate by scanning connected step.shell embedOutput cmds
// against any Bash(...) rules present on connected subagents / the command itself.
// We collect allow-list Bash rules from the graph settings.permissions.allow too.
const cf203: Rule = {
  id: 'CF203',
  severity: 'error',
  run(graph) {
    const byId = nodeById(graph);
    const allowRules = graph.settings.permissions?.allow ?? [];
    const diags: Diagnostic[] = [];
    for (const cmd of nodesOfKind(graph, 'trigger.slashCommand')) {
      for (const succId of successors(graph, cmd.id)) {
        const n = byId.get(succId);
        if (n?.kind !== 'step.shell' || !n.data.embedOutput) continue;
        const token = firstToken(n.data.command);
        if (token && !bashRuleCovers(allowRules, token)) {
          diags.push({
            ruleId: 'CF203',
            severity: 'error',
            nodeId: n.id,
            field: 'command',
            message: `Embedded !\`${token} …\` is not covered by an allowed-tools Bash rule.`,
            docsUrl: DOCS_URLS.permissions,
            quickFix: {
              title: `Add Bash(${token} *) to allow list`,
              apply: (g: WorkflowGraph) => {
                const next = structuredClone(g);
                next.settings.permissions ??= { allow: [], deny: [], ask: [] };
                next.settings.permissions.allow = [
                  ...next.settings.permissions.allow,
                  `Bash(${token} *)`,
                ];
                return next;
              },
            },
          });
        }
      }
    }
    return diags;
  },
};

// CF204 — skill description over budget guidance.
const cf204: Rule = {
  id: 'CF204',
  severity: 'warn',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const cmd of nodesOfKind(graph, 'trigger.slashCommand')) {
      if (cmd.data.description.length > SKILL_DESC_BUDGET) {
        diags.push({
          ruleId: 'CF204',
          severity: 'warn',
          nodeId: cmd.id,
          field: 'description',
          message: `Skill description is ${cmd.data.description.length} chars; keep < ${SKILL_DESC_BUDGET} (shares the skill-description budget).`,
          docsUrl: DOCS_URLS.skills,
        });
      }
    }
    return diags;
  },
};

// CF205 — agent: frontmatter references unknown subagent node.
const cf205: Rule = {
  id: 'CF205',
  severity: 'error',
  run(graph) {
    const agentNames = new Set(nodesOfKind(graph, 'step.subagent').map((n) => n.data.name));
    const diags: Diagnostic[] = [];
    for (const cmd of nodesOfKind(graph, 'trigger.slashCommand')) {
      if (cmd.data.agent && !agentNames.has(cmd.data.agent)) {
        diags.push({
          ruleId: 'CF205',
          severity: 'error',
          nodeId: cmd.id,
          field: 'agent',
          message: `agent: "${cmd.data.agent}" references an unknown subagent.`,
          docsUrl: DOCS_URLS.subAgents,
        });
      }
    }
    return diags;
  },
};

// CF206 — disable-model-invocation + vague description (dead weight in context).
const cf206: Rule = {
  id: 'CF206',
  severity: 'warn',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const cmd of nodesOfKind(graph, 'trigger.slashCommand')) {
      const vague = cmd.data.description.trim().length < 15;
      if (cmd.data.disableModelInvocation && vague) {
        diags.push({
          ruleId: 'CF206',
          severity: 'warn',
          nodeId: cmd.id,
          field: 'description',
          message:
            'disable-model-invocation with a vague description is dead weight in context; either flesh out the description or drop the flag.',
          docsUrl: DOCS_URLS.skills,
        });
      }
    }
    return diags;
  },
};

// CF207 — @file reference to a path that is a graph-declared generated output.
const cf207: Rule = {
  id: 'CF207',
  severity: 'error',
  run(graph) {
    // Generated outputs we can predict from the graph: SKILL.md and agent files.
    const generated = new Set<string>();
    for (const cmd of nodesOfKind(graph, 'trigger.slashCommand')) {
      generated.add(`.claude/skills/${cmd.data.name}/SKILL.md`);
    }
    for (const a of nodesOfKind(graph, 'step.subagent')) {
      generated.add(`.claude/agents/${a.data.name}.md`);
    }
    const diags: Diagnostic[] = [];
    for (const ref of nodesOfKind(graph, 'step.fileRef')) {
      for (const p of ref.data.paths) {
        const norm = p.replace(/^\.?\//, '');
        if (generated.has(norm)) {
          diags.push({
            ruleId: 'CF207',
            severity: 'error',
            nodeId: ref.id,
            field: 'paths',
            message: `@${p} references a file this workflow generates (ordering hazard).`,
            docsUrl: DOCS_URLS.skills,
          });
        }
      }
    }
    return diags;
  },
};

export const skillRules: Rule[] = [cf201, cf202, cf203, cf204, cf205, cf206, cf207];
