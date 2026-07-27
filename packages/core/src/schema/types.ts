// Source of truth: docs/SPEC-NODES.md. Keep in lockstep.
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type PermissionMode =
  | 'default' | 'plan' | 'acceptEdits' | 'auto' | 'dontAsk' | 'bypassPermissions';

export type HookEvent =
  | 'SessionStart' | 'Setup' | 'InstructionsLoaded' | 'UserPromptSubmit'
  | 'UserPromptExpansion' | 'PreToolUse' | 'PermissionRequest' | 'PermissionDenied'
  | 'PostToolUse' | 'PostToolUseFailure' | 'PostToolBatch' | 'Notification'
  | 'MessageDisplay' | 'SubagentStart' | 'SubagentStop' | 'TaskCreated'
  | 'TaskCompleted' | 'Stop' | 'StopFailure' | 'TeammateIdle' | 'ConfigChange'
  | 'CwdChanged' | 'FileChanged' | 'WorktreeCreate' | 'WorktreeRemove'
  | 'PreCompact' | 'PostCompact' | 'Elicitation' | 'ElicitationResult' | 'SessionEnd';

/** Events where exit 2 / decision:"block" actually blocks (see SPEC-CODEGEN table). */
export const BLOCKABLE_EVENTS: ReadonlySet<HookEvent> = new Set([
  'PreToolUse', 'PermissionRequest', 'UserPromptSubmit', 'UserPromptExpansion',
  'Stop', 'SubagentStop', 'TeammateIdle', 'TaskCreated', 'TaskCompleted',
  'ConfigChange', 'PostToolBatch', 'PreCompact', 'Elicitation',
  'ElicitationResult', 'WorktreeCreate',
]);

export interface GeneratedFile {
  path: string;            // relative to project root, e.g. ".claude/skills/x/SKILL.md"
  content: string;
  executable?: boolean;    // chmod +x for hook scripts
}
