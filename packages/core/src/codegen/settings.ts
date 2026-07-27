// settings.json / settings.local.json + run.sh emitters, plus the hooks block
// assembled from hook chains. SPEC-CODEGEN "Hooks mapping" + "GlobalSettings mapping".
import type { GeneratedFile } from '../schema/types.js';
import type { WorkflowGraph } from '../schema/graph.js';
import { stableJson } from './json.js';
import { emitHookScript } from './script.js';
import { shSingleQuote } from './script.js';
import { hookChains } from './model.js';
import type { HookChain } from './model.js';

interface HandlerJson {
  type: string;
  [k: string]: unknown;
}

/** A single settings.json hooks entry: { matcher?, hooks: [handler...] }. */
interface HookEntry {
  matcher?: string;
  hooks: HandlerJson[];
}

export interface HooksBuild {
  /** hooks block grouped by event, ready to merge into settings.json. */
  block: Record<string, HookEntry[]>;
  /** generated .sh files for command handlers with script bodies. */
  scripts: GeneratedFile[];
}

function scriptFileName(event: string, index: number): string {
  return `${event.toLowerCase()}-${index + 1}.sh`;
}

/** Build the handler JSON for one chain, emitting a script file if needed. */
function handlerFor(
  chain: HookChain,
  index: number,
  scripts: GeneratedFile[],
): HandlerJson {
  const h = chain.handler;
  switch (h.kind) {
    case 'hook.command': {
      const d = h.data;
      if (d.scriptBody !== undefined || chain.decision) {
        // Materialize a script file and reference it in EXEC FORM.
        const file = scriptFileName(chain.event, index);
        const path = `.claude/hooks/${file}`;
        scripts.push({
          path,
          executable: true,
          content: emitHookScript({
            event: chain.event,
            body: d.scriptBody ?? (d.command && d.command !== 'bash' ? d.command : undefined),
            decision: chain.decision,
          }),
        });
        const handler: HandlerJson = {
          type: 'command',
          command: `\${CLAUDE_PROJECT_DIR}/${path}`,
          args: [],
        };
        assignCommon(handler, d);
        return handler;
      }
      const handler: HandlerJson = { type: 'command', command: d.command };
      if (d.args) handler.args = d.args;
      if (d.shell) handler.shell = d.shell;
      assignCommon(handler, d);
      return handler;
    }
    case 'hook.http': {
      const d = h.data;
      const handler: HandlerJson = { type: 'http', url: d.url };
      if (d.headers) handler.headers = d.headers;
      if (d.allowedEnvVars) handler.allowedEnvVars = d.allowedEnvVars;
      if (d.timeout !== undefined) handler.timeout = d.timeout;
      return handler;
    }
    case 'hook.prompt': {
      const d = h.data;
      const handler: HandlerJson = { type: 'prompt', prompt: d.prompt };
      if (d.model) handler.model = d.model;
      return handler;
    }
    case 'hook.agent': {
      const d = h.data;
      const handler: HandlerJson = { type: 'agent', prompt: d.prompt };
      if (d.model) handler.model = d.model;
      return handler;
    }
    case 'step.mcpTool': {
      const d = h.data;
      const handler: HandlerJson = { type: 'mcp_tool', server: d.server, tool: d.tool };
      if (d.input) handler.input = d.input;
      return handler;
    }
  }
}

function assignCommon(
  handler: HandlerJson,
  d: Extract<HookChain['handler'], { kind: 'hook.command' }>['data'],
): void {
  if (d.timeout !== undefined) handler.timeout = d.timeout;
  if (d.statusMessage) handler.statusMessage = d.statusMessage;
  if (d.async) handler.async = true;
  if (d.asyncRewake) handler.asyncRewake = true;
  if (d.if) handler.if = d.if;
  // `once` is intentionally not emitted to settings.json (CF107 — skill-only).
}

/** Assemble the hooks block and generated scripts from the graph. */
export function buildHooks(graph: WorkflowGraph): HooksBuild {
  const chains = hookChains(graph);
  const block: Record<string, HookEntry[]> = {};
  const scripts: GeneratedFile[] = [];

  chains.forEach((chain, index) => {
    const handler = handlerFor(chain, index, scripts);
    const matcher = chain.matcher ?? chain.gate?.matcher;
    const entries = (block[chain.event] ??= []);
    // Group handlers that share the same matcher into one entry.
    const existing = entries.find((en) => en.matcher === matcher);
    if (existing) existing.hooks.push(handler);
    else entries.push(matcher !== undefined ? { matcher, hooks: [handler] } : { hooks: [handler] });
  });

  return { block, scripts };
}

/** Map GlobalSettings + hooks into settings.json (project) content. */
export function emitSettings(graph: WorkflowGraph, hooksBlock: Record<string, unknown>): GeneratedFile[] {
  const s = graph.settings;
  const settings: Record<string, unknown> = {};

  if (s.model) settings.model = s.model;
  // effort low/medium/high → settings.json; xhigh/max → run.sh only (CF401).
  if (s.effort && s.effort !== 'xhigh' && s.effort !== 'max') settings.effortLevel = s.effort;
  if (s.outputStyle) settings.outputStyle = s.outputStyle;
  if (s.disableAllHooks) settings.disableAllHooks = true;
  if (s.env && Object.keys(s.env).length) settings.env = s.env;

  const permissions: Record<string, unknown> = {};
  if (s.permissionMode) permissions.defaultMode = s.permissionMode;
  if (s.permissions) {
    if (s.permissions.allow.length) permissions.allow = s.permissions.allow;
    if (s.permissions.deny.length) permissions.deny = s.permissions.deny;
    if (s.permissions.ask.length) permissions.ask = s.permissions.ask;
  }
  if (Object.keys(permissions).length) settings.permissions = permissions;

  if (Object.keys(hooksBlock).length) settings.hooks = hooksBlock;

  if (Object.keys(settings).length === 0) return [];
  return [{ path: '.claude/settings.json', content: stableJson(settings) }];
}

/** Build run.sh when a headless runner is configured. SPEC-CODEGEN GlobalSettings row. */
export function emitRunScript(graph: WorkflowGraph): GeneratedFile[] {
  const s = graph.settings;
  const headlessNode = graph.nodes.find((n) => n.kind === 'trigger.headless');
  const enabled = s.headless?.enabled || headlessNode !== undefined;
  if (!enabled) return [];

  const promptTemplate =
    headlessNode?.kind === 'trigger.headless' ? headlessNode.data.promptTemplate : 'Run the workflow.';
  const initMode =
    headlessNode?.kind === 'trigger.headless' ? headlessNode.data.initMode : undefined;

  const parts: string[] = ['claude', '-p', shSingleQuote(promptTemplate)];
  if (s.model) parts.push('--model', shSingleQuote(s.model));

  const lines: string[] = ['#!/bin/bash', '# Generated by Claude Flow Designer — headless runner.', 'set -euo pipefail', ''];

  if (s.effort === 'xhigh' || s.effort === 'max') {
    lines.push(`# effort ${s.effort} is set via CLI flag, not settings.json (known flakiness; SPEC-CODEGEN).`);
    parts.push('--effort', s.effort);
  } else if (s.effort) {
    parts.push('--effort', s.effort);
  }

  const h = s.headless;
  if (h?.worktree) parts.push('--worktree');
  if (h?.outputFormat) parts.push('--output-format', h.outputFormat);
  if (h?.maxTurns !== undefined) parts.push('--max-turns', String(h.maxTurns));
  if (h?.verbose) parts.push('--verbose');
  if (initMode === 'init') parts.push('--init');
  else if (initMode === 'init-only') parts.push('--init-only');
  else if (initMode === 'maintenance') parts.push('--maintenance');

  lines.push(parts.join(' '));
  return [{ path: 'run.sh', executable: true, content: lines.join('\n') + '\n' }];
}
