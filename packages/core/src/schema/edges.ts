// Single source of truth for edge compatibility between node kinds (SPEC-NODES
// connection rules). Used by CF005 (validation) AND the canvas (to reject invalid
// drag-connections up front), so the two can never disagree.
import type { NodeKind } from './nodes.js';

const STEP_KINDS: ReadonlySet<NodeKind> = new Set([
  'step.prompt', 'step.shell', 'step.fileRef', 'step.subagent', 'step.mcpTool',
]);
const HOOK_HANDLER_KINDS: ReadonlySet<NodeKind> = new Set([
  'hook.command', 'hook.http', 'hook.prompt', 'hook.agent', 'step.mcpTool',
]);

/** May an edge connect a `source` node to a `target` node? */
export function edgeAllowed(source: NodeKind, target: NodeKind): boolean {
  switch (source) {
    case 'trigger.slashCommand':
      // A command composes steps (and may delegate to a subagent).
      return STEP_KINDS.has(target);
    case 'trigger.hookEvent':
    case 'trigger.sessionStart':
      // A hook-event trigger feeds a gate or a handler.
      return target === 'gate.condition' || HOOK_HANDLER_KINDS.has(target);
    case 'gate.condition':
      return HOOK_HANDLER_KINDS.has(target);
    case 'hook.command':
    case 'hook.http':
    case 'hook.prompt':
    case 'hook.agent':
      return target === 'output.decision';
    case 'trigger.headless':
      return STEP_KINDS.has(target);
    default:
      // steps → steps or a decision; keep permissive to avoid false positives.
      return STEP_KINDS.has(target) || target === 'output.decision';
  }
}
