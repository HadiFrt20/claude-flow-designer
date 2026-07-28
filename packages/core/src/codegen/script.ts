// Generated hook .sh scripts. Conventions (SPEC-CODEGEN "Generated script
// conventions"): #!/bin/bash, set -euo pipefail, jq guard first, read stdin once,
// decision tail per the blockability table. JSON output shapes follow the per-event
// hookSpecificOutput contract (docs/REFERENCE-CLAUDE-CODE.md; verified against
// code.claude.com/docs/en/hooks). Output MUST pass shellcheck.
import { BLOCKABLE_EVENTS } from '../schema/types.js';
import type { HookEvent } from '../schema/types.js';
import type { DecisionData } from '../schema/nodes.js';

const GUARD = 'command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }';

/** permissionDecision value (PreToolUse). `block` maps to `deny`. */
function permissionDecision(mode: DecisionData['mode']): 'allow' | 'deny' | 'ask' | undefined {
  switch (mode) {
    case 'allow':
      return 'allow';
    case 'deny':
    case 'block':
      return 'deny';
    case 'ask':
      return 'ask';
    default:
      return undefined;
  }
}

// Events whose additionalContext nests under hookSpecificOutput.
const ADDL_CONTEXT_NESTED: ReadonlySet<HookEvent> = new Set<HookEvent>([
  'SessionStart', 'UserPromptSubmit', 'UserPromptExpansion',
  'PostToolUse', 'Stop', 'SubagentStop',
]);

/**
 * Build the JSON object a decision emits, as a jq object-literal string plus the
 * `--arg` bindings for its string values. Shapes are event-specific:
 *  - PreToolUse: hookSpecificOutput{ permissionDecision, permissionDecisionReason, updatedInput }
 *  - PermissionRequest: hookSpecificOutput{ decision:{ behavior, updatedInput } }
 *  - PostToolUse: hookSpecificOutput{ updatedToolOutput, additionalContext }
 *  - SessionStart/UserPromptSubmit/UserPromptExpansion: hookSpecificOutput{ additionalContext }
 *  - block (top-level events): top-level decision:"block" + reason
 *  - stopAll: top-level continue:false + stopReason
 * systemMessage/suppressOutput are universal top-level fields.
 */
function decisionJsonArgs(event: HookEvent, dec: DecisionData): { args: string[]; obj: string } {
  const args: string[] = [];
  const top: string[] = []; // top-level object fields
  const hso: string[] = [`hookEventName: "${event}"`]; // hookSpecificOutput fields
  let usesHso = false;

  const bindStr = (value: string, jqField: string): string => {
    args.push(`--arg ${jqField} ${shSingleQuote(value)}`);
    return `$${jqField}`;
  };
  // Raw jq value (object literal) via --argjson.
  const bindJson = (value: unknown, jqField: string): string => {
    args.push(`--argjson ${jqField} ${shSingleQuote(JSON.stringify(value))}`);
    return `$${jqField}`;
  };

  if (event === 'PreToolUse') {
    usesHso = true;
    const pd = permissionDecision(dec.mode);
    if (pd) hso.push(`permissionDecision: "${pd}"`);
    if (dec.reason) hso.push(`permissionDecisionReason: ${bindStr(dec.reason, 'reason')}`);
    if (dec.updatedInput) hso.push(`updatedInput: ${bindJson(dec.updatedInput, 'uinput')}`);
  } else if (event === 'PermissionRequest') {
    usesHso = true;
    const behavior = dec.mode === 'allow' ? 'allow' : 'deny';
    const decisionInner = [`behavior: "${behavior}"`];
    if (dec.updatedInput) decisionInner.push(`updatedInput: ${bindJson(dec.updatedInput, 'uinput')}`);
    hso.push(`decision: { ${decisionInner.join(', ')} }`);
  } else if (event === 'PostToolUse') {
    usesHso = true;
    if (dec.updatedToolOutput) {
      hso.push(`updatedToolOutput: ${bindJson(dec.updatedToolOutput, 'utoutput')}`);
    }
  } else if (dec.mode === 'block') {
    top.push('decision: "block"');
    if (dec.reason) top.push(`reason: ${bindStr(dec.reason, 'reason')}`);
  } else if (dec.mode === 'stopAll') {
    top.push('continue: false');
    if (dec.reason) top.push(`stopReason: ${bindStr(dec.reason, 'reason')}`);
  }

  if (dec.additionalContext) {
    if (ADDL_CONTEXT_NESTED.has(event)) {
      usesHso = true;
      hso.push(`additionalContext: ${bindStr(dec.additionalContext, 'actx')}`);
    } else {
      top.push(`additionalContext: ${bindStr(dec.additionalContext, 'actx')}`);
    }
  }
  // Universal top-level fields (all events).
  if (dec.systemMessage) top.push(`systemMessage: ${bindStr(dec.systemMessage, 'sysmsg')}`);
  if (dec.suppressOutput) top.push('suppressOutput: true');

  if (usesHso) top.push(`hookSpecificOutput: { ${hso.join(', ')} }`);
  return { args, obj: `{ ${top.join(', ')} }` };
}

export interface ScriptSpec {
  event: HookEvent;
  /** Inline body from hook.command.scriptBody, or a single command line. */
  body?: string;
  /** The decision this hook emits, if any. */
  decision?: DecisionData;
}

/**
 * Emit a complete, shellcheck-clean hook script. The jq guard + stdin read are
 * always present (CF115 invariant); `input` gets a documented SC2034 suppression
 * when nothing downstream references it.
 */
export function emitHookScript(spec: ScriptSpec): string {
  const { event, body, decision } = spec;
  const lines: string[] = [];
  const post: string[] = []; // everything after the input read

  if (body && body.trim()) post.push(body.trimEnd());

  const referencesInput = /\binput\b/.test(body ?? '');

  if (decision) {
    const blockable = BLOCKABLE_EVENTS.has(event);
    const wantsExit2 =
      decision.blockStyle === 'exit2' &&
      (decision.mode === 'block' || decision.mode === 'deny') &&
      blockable;
    if (wantsExit2) {
      // Bare exit-2 block: reason to stderr, exit 2.
      if (decision.reason) {
        post.push(`echo ${shSingleQuote(decision.reason)} >&2`);
      }
      post.push('exit 2');
    } else {
      const { args, obj } = decisionJsonArgs(event, decision);
      const argStr = args.length ? args.join(' ') + ' ' : '';
      post.push(`jq -n ${argStr}${shSingleQuote(obj)}`);
      post.push('exit 0');
    }
  }

  // Header
  lines.push('#!/bin/bash');
  lines.push(`# Generated by Claude Flow Designer — hook for ${event}. Do not edit by hand.`);
  lines.push('set -euo pipefail');
  lines.push(GUARD);
  lines.push('');
  if (!referencesInput) {
    lines.push('# stdin carries the hook payload; read it even if this handler ignores fields.');
    lines.push('# shellcheck disable=SC2034');
  }
  lines.push('input=$(cat)');
  if (post.length) {
    lines.push('');
    lines.push(...post);
  }
  return lines.join('\n') + '\n';
}

/** Single-quote a string for POSIX sh, escaping embedded single quotes. */
export function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
