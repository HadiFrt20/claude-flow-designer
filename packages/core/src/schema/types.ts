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

/** Stable diagnostic identifiers — documented in docs/SPEC-VALIDATION.md, never renumber. */
export type RuleId =
  // graph structure
  | 'CF001' | 'CF002' | 'CF003' | 'CF004' | 'CF005' | 'CF006' | 'CF007' | 'CF008'
  // hooks
  | 'CF101' | 'CF102' | 'CF103' | 'CF104' | 'CF105' | 'CF106' | 'CF107' | 'CF108'
  | 'CF109' | 'CF110' | 'CF111' | 'CF112' | 'CF113' | 'CF114' | 'CF115'
  // skills / commands
  | 'CF201' | 'CF202' | 'CF203' | 'CF204' | 'CF205' | 'CF206' | 'CF207'
  // subagents
  | 'CF301' | 'CF302' | 'CF303'
  // settings / model / effort
  | 'CF401' | 'CF402' | 'CF403' | 'CF404' | 'CF405' | 'CF406' | 'CF407'
  // headless / runner
  | 'CF501' | 'CF502' | 'CF503' | 'CF504';
