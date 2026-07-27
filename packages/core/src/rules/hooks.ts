// Hook rules CF101–CF115. See docs/SPEC-VALIDATION.md ("Hooks") and the blockability
// + matcher-semantics tables in docs/SPEC-CODEGEN.md.
import type { Diagnostic, Rule } from '../diagnostics.js';
import type { WorkflowGraph } from '../schema/graph.js';
import { BLOCKABLE_EVENTS } from '../schema/types.js';
import { governingHookEvent, nodesOfKind } from '../schema/graph-utils.js';
import { patchNodeData, mapNode } from './quickfix-utils.js';
import {
  DOCS_URLS,
  MATCHER_EVENTS,
  SESSION_LIFECYCLE_EVENTS,
  TOOL_EVENTS,
  isBareMcpMatcher,
  isUnanchoredRegexMatcher,
} from './helpers.js';

// CF101 — blocking decision on a non-blockable event.
const cf101: Rule = {
  id: 'CF101',
  severity: 'error',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const dec of nodesOfKind(graph, 'output.decision')) {
      const blocks =
        dec.data.mode === 'block' ||
        dec.data.mode === 'deny' ||
        dec.data.mode === 'stopAll' ||
        dec.data.blockStyle === 'exit2';
      if (!blocks) continue;
      const event = governingHookEvent(graph, dec.id);
      if (event && !BLOCKABLE_EVENTS.has(event)) {
        diags.push({
          ruleId: 'CF101',
          severity: 'error',
          nodeId: dec.id,
          field: 'mode',
          message: `Blocking decision (${dec.data.mode}) on non-blockable event "${event}". Use a side-effect output instead.`,
          docsUrl: DOCS_URLS.hooks,
        });
      }
    }
    return diags;
  },
};

// CF102 — `if` condition on a non-tool event (hook would never run).
const cf102: Rule = {
  id: 'CF102',
  severity: 'error',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const h of nodesOfKind(graph, 'hook.command')) {
      if (!h.data.if) continue;
      const event = governingHookEvent(graph, h.id);
      if (event && !TOOL_EVENTS.has(event)) {
        diags.push({
          ruleId: 'CF102',
          severity: 'error',
          nodeId: h.id,
          field: 'if',
          message: `"if" condition on non-tool event "${event}" — the hook would never run.`,
          docsUrl: DOCS_URLS.hooks,
          quickFix: {
            title: 'Remove the "if" condition',
            apply: (g: WorkflowGraph) =>
              patchNodeData(g, h.id, 'hook.command', (d) => {
                delete d.if;
              }),
          },
        });
      }
    }
    return diags;
  },
};

// CF103 — matcher set on an event that ignores matchers.
const cf103: Rule = {
  id: 'CF103',
  severity: 'error',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const t of nodesOfKind(graph, 'trigger.hookEvent')) {
      if (t.data.matcher && !MATCHER_EVENTS.has(t.data.event)) {
        diags.push({
          ruleId: 'CF103',
          severity: 'error',
          nodeId: t.id,
          field: 'matcher',
          message: `Event "${t.data.event}" ignores matchers; remove the matcher.`,
          docsUrl: DOCS_URLS.hooks,
          quickFix: {
            title: 'Remove the matcher',
            apply: (g: WorkflowGraph) =>
              patchNodeData(g, t.id, 'trigger.hookEvent', (d) => {
                delete d.matcher;
              }),
          },
        });
      }
    }
    return diags;
  },
};

// CF104 — bare `mcp__<server>` matcher matches nothing.
const cf104: Rule = {
  id: 'CF104',
  severity: 'error',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const t of nodesOfKind(graph, 'trigger.hookEvent')) {
      const m = t.data.matcher;
      if (m && isBareMcpMatcher(m)) {
        diags.push({
          ruleId: 'CF104',
          severity: 'error',
          nodeId: t.id,
          field: 'matcher',
          message: `Bare "${m}" matcher matches nothing; append "__.*".`,
          docsUrl: DOCS_URLS.hooks,
          quickFix: {
            title: `Change to "${m}__.*"`,
            apply: (g: WorkflowGraph) =>
              patchNodeData(g, t.id, 'trigger.hookEvent', (d) => {
                d.matcher = `${m}__.*`;
              }),
          },
        });
      }
    }
    return diags;
  },
};

// CF105 — unanchored regex matcher that over-matches.
const cf105: Rule = {
  id: 'CF105',
  severity: 'warn',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const t of nodesOfKind(graph, 'trigger.hookEvent')) {
      const m = t.data.matcher;
      // MCP wildcard forms are legitimately unanchored; don't flag them.
      if (m && !m.startsWith('mcp__') && isUnanchoredRegexMatcher(m)) {
        diags.push({
          ruleId: 'CF105',
          severity: 'warn',
          nodeId: t.id,
          field: 'matcher',
          message: `Unanchored regex matcher "${m}" may over-match (e.g. also hits longer tool names). Anchor with ^...$.`,
          docsUrl: DOCS_URLS.hooks,
          quickFix: {
            title: `Anchor to "^${m}$"`,
            apply: (g: WorkflowGraph) =>
              patchNodeData(g, t.id, 'trigger.hookEvent', (d) => {
                d.matcher = `^${m}$`;
              }),
          },
        });
      }
    }
    return diags;
  },
};

// CF106 — hook command references a path placeholder in shell form without quotes.
const cf106: Rule = {
  id: 'CF106',
  severity: 'error',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const h of nodesOfKind(graph, 'hook.command')) {
      // Shell form = no exec-form args array. A path placeholder like
      // ${CLAUDE_PROJECT_DIR}/x or $CLAUDE_PLUGIN_ROOT unquoted is unsafe.
      const isExecForm = Array.isArray(h.data.args);
      if (isExecForm) continue;
      const cmd = h.data.command;
      const hasPlaceholder = /\$\{?CLAUDE_(PROJECT_DIR|PLUGIN_ROOT|PLUGIN_DATA)\}?/.test(cmd);
      const unquoted = hasPlaceholder && !/["'][^"']*\$\{?CLAUDE_/.test(cmd);
      if (hasPlaceholder && unquoted) {
        diags.push({
          ruleId: 'CF106',
          severity: 'error',
          nodeId: h.id,
          field: 'command',
          message:
            'Path placeholder used in shell form without quotes; switch to exec form (args) to avoid word-splitting.',
          docsUrl: DOCS_URLS.hooks,
          quickFix: {
            title: 'Switch to exec form',
            apply: (g: WorkflowGraph) =>
              patchNodeData(g, h.id, 'hook.command', (d) => {
                if (!Array.isArray(d.args)) d.args = [];
              }),
          },
        });
      }
    }
    return diags;
  },
};

// CF107 — `once: true` outside skill frontmatter (ignored on settings.json hooks).
const cf107: Rule = {
  id: 'CF107',
  severity: 'warn',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const h of nodesOfKind(graph, 'hook.command')) {
      if (h.data.once) {
        diags.push({
          ruleId: 'CF107',
          severity: 'warn',
          nodeId: h.id,
          field: 'once',
          message: '"once: true" is only honoured in skill frontmatter; ignored on settings.json hooks.',
          docsUrl: DOCS_URLS.hooks,
          quickFix: {
            title: 'Remove "once"',
            apply: (g: WorkflowGraph) =>
              patchNodeData(g, h.id, 'hook.command', (d) => {
                delete d.once;
              }),
          },
        });
      }
    }
    return diags;
  },
};

// CF108 — UserPromptSubmit handler with timeout > 30s default (stalls every prompt).
const cf108: Rule = {
  id: 'CF108',
  severity: 'warn',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const h of nodesOfKind(graph, 'hook.command')) {
      if (h.data.timeout === undefined) continue;
      const event = governingHookEvent(graph, h.id);
      if (event === 'UserPromptSubmit' && h.data.timeout > 30) {
        diags.push({
          ruleId: 'CF108',
          severity: 'warn',
          nodeId: h.id,
          field: 'timeout',
          message: `UserPromptSubmit handler timeout ${h.data.timeout}s > 30s stalls every prompt.`,
          docsUrl: DOCS_URLS.hooks,
          quickFix: {
            title: 'Lower timeout to 30s',
            apply: (g: WorkflowGraph) =>
              patchNodeData(g, h.id, 'hook.command', (d) => {
                d.timeout = 30;
              }),
          },
        });
      }
    }
    return diags;
  },
};

// CF109 — MessageDisplay handler with timeout > 10s.
const cf109: Rule = {
  id: 'CF109',
  severity: 'warn',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const h of nodesOfKind(graph, 'hook.command')) {
      if (h.data.timeout === undefined) continue;
      const event = governingHookEvent(graph, h.id);
      if (event === 'MessageDisplay' && h.data.timeout > 10) {
        diags.push({
          ruleId: 'CF109',
          severity: 'warn',
          nodeId: h.id,
          field: 'timeout',
          message: `MessageDisplay handler timeout ${h.data.timeout}s > 10s.`,
          docsUrl: DOCS_URLS.hooks,
          quickFix: {
            title: 'Lower timeout to 10s',
            apply: (g: WorkflowGraph) =>
              patchNodeData(g, h.id, 'hook.command', (d) => {
                d.timeout = 10;
              }),
          },
        });
      }
    }
    return diags;
  },
};

// CF110 — hook.agent is experimental; require explicit ack (modeled as error+warn?).
// Doc marks it error "require explicit ack"; we emit an error so the export gate
// forces an acked decision only if the team downgrades; keep as error per catalog.
const cf110: Rule = {
  id: 'CF110',
  severity: 'error',
  run(graph) {
    return nodesOfKind(graph, 'hook.agent').map(
      (h): Diagnostic => ({
        ruleId: 'CF110',
        severity: 'error',
        nodeId: h.id,
        message: 'hook.agent handler is experimental; requires explicit acknowledgment before export.',
        docsUrl: DOCS_URLS.hooks,
      }),
    );
  },
};

// CF111 — SessionStart/Setup handler of type http/prompt/agent (only command & mcp_tool).
const cf111: Rule = {
  id: 'CF111',
  severity: 'error',
  run(graph) {
    const diags: Diagnostic[] = [];
    const check = (nodeId: string, kindLabel: string) => {
      const event = governingHookEvent(graph, nodeId);
      if (event && SESSION_LIFECYCLE_EVENTS.has(event)) {
        diags.push({
          ruleId: 'CF111',
          severity: 'error',
          nodeId,
          message: `${event} only supports command & mcp_tool handlers, not ${kindLabel}.`,
          docsUrl: DOCS_URLS.hooks,
        });
      }
    };
    for (const h of nodesOfKind(graph, 'hook.http')) check(h.id, 'http');
    for (const h of nodesOfKind(graph, 'hook.prompt')) check(h.id, 'prompt');
    for (const h of nodesOfKind(graph, 'hook.agent')) check(h.id, 'agent');
    return diags;
  },
};

// CF112 — mcp_tool hook on SessionStart/Setup (server likely not connected yet).
const cf112: Rule = {
  id: 'CF112',
  severity: 'warn',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const h of nodesOfKind(graph, 'step.mcpTool')) {
      const event = governingHookEvent(graph, h.id);
      if (event && SESSION_LIFECYCLE_EVENTS.has(event)) {
        diags.push({
          ruleId: 'CF112',
          severity: 'warn',
          nodeId: h.id,
          message: `mcp_tool hook on ${event}: the MCP server is likely not connected yet.`,
          docsUrl: DOCS_URLS.hooks,
        });
      }
    }
    return diags;
  },
};

// CF113 — PermissionDenied hook using exit 2 (ignored) instead of JSON retry.
const cf113: Rule = {
  id: 'CF113',
  severity: 'error',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const dec of nodesOfKind(graph, 'output.decision')) {
      const event = governingHookEvent(graph, dec.id);
      if (event !== 'PermissionDenied') continue;
      if (dec.data.blockStyle === 'exit2' || dec.data.mode === 'block') {
        diags.push({
          ruleId: 'CF113',
          severity: 'error',
          nodeId: dec.id,
          field: 'blockStyle',
          message: 'PermissionDenied ignores exit 2; use JSON "retry:true" output instead.',
          docsUrl: DOCS_URLS.hooks,
          quickFix: {
            title: 'Convert to JSON retry',
            apply: (g: WorkflowGraph) =>
              patchNodeData(g, dec.id, 'output.decision', (d) => {
                d.blockStyle = 'json';
                d.mode = 'ask';
              }),
          },
        });
      }
    }
    return diags;
  },
};

// CF114 — hook relies on exit code 1 to block (only 2 blocks).
const cf114: Rule = {
  id: 'CF114',
  severity: 'warn',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const dec of nodesOfKind(graph, 'output.decision')) {
      if (dec.data.blockStyle === 'exit1') {
        diags.push({
          ruleId: 'CF114',
          severity: 'warn',
          nodeId: dec.id,
          field: 'blockStyle',
          message: 'Exit code 1 is non-blocking; only exit 2 blocks. Change to exit 2.',
          docsUrl: DOCS_URLS.hooks,
          quickFix: {
            title: 'Change to exit 2',
            apply: (g: WorkflowGraph) =>
              patchNodeData(g, dec.id, 'output.decision', (d) => {
                d.blockStyle = 'exit2';
              }),
          },
        });
      }
    }
    return diags;
  },
};

// CF115 — generated script missing jq guard or stdin read (codegen invariant).
// At the graph level we can only assert the *intent*: a hook.command that has a
// scriptBody must contain a jq guard + stdin read. Codegen inserts these
// automatically, so a hand-authored scriptBody lacking them is the failure mode.
const cf115: Rule = {
  id: 'CF115',
  severity: 'error',
  run(graph) {
    const diags: Diagnostic[] = [];
    for (const h of nodesOfKind(graph, 'hook.command')) {
      const body = h.data.scriptBody;
      if (body === undefined) continue;
      const hasJqGuard = /command -v jq/.test(body);
      const readsStdin = /\bcat\b|<<</.test(body) || /\$\(cat\)/.test(body);
      if (!hasJqGuard || !readsStdin) {
        diags.push({
          ruleId: 'CF115',
          severity: 'error',
          nodeId: h.id,
          field: 'scriptBody',
          message:
            'Generated script must include a jq availability guard and read stdin once. Regenerate the script body.',
          docsUrl: DOCS_URLS.hooks,
          quickFix: {
            title: 'Insert jq guard + stdin read',
            apply: (g: WorkflowGraph) =>
              mapNode(g, h.id, (node) => {
                if (node.kind !== 'hook.command') return node;
                const guard =
                  'command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }\ninput=$(cat)\n';
                const existing = node.data.scriptBody ?? '';
                return { ...node, data: { ...node.data, scriptBody: guard + existing } };
              }),
          },
        });
      }
    }
    return diags;
  },
};

export const hookRules: Rule[] = [
  cf101, cf102, cf103, cf104, cf105, cf106, cf107, cf108, cf109, cf110,
  cf111, cf112, cf113, cf114, cf115,
];
