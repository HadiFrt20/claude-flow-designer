// Shared helpers for validation rules: Claude Code semantics distilled from
// docs/SPEC-CODEGEN.md and docs/REFERENCE-CLAUDE-CODE.md. Keep citations in comments.
import type { HookEvent } from '../schema/types.js';

const DOCS = 'https://code.claude.com/docs/en';
export const DOCS_URLS = {
  hooks: `${DOCS}/hooks`,
  hooksGuide: `${DOCS}/hooks-guide`,
  skills: `${DOCS}/skills`,
  subAgents: `${DOCS}/sub-agents`,
  settings: `${DOCS}/settings`,
  permissions: `${DOCS}/permissions`,
  modelConfig: `${DOCS}/model-config`,
  cli: `${DOCS}/cli-reference`,
  headless: `${DOCS}/headless`,
} as const;

/**
 * Events that carry a tool context (tool_name/tool_input). `if` conditions and
 * `matcher`s only make sense here (REFERENCE: "if — ONE permission rule, tool
 * events only"). PermissionDenied/PostToolUseFailure are tool-adjacent and do
 * receive tool fields.
 */
export const TOOL_EVENTS: ReadonlySet<HookEvent> = new Set<HookEvent>([
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied',
]);

/**
 * Events that honour a `matcher` (a subset of tool events — the matcher filters
 * by tool name). Events like UserPromptSubmit/Stop/PostToolBatch ignore matchers
 * entirely (CF103).
 */
export const MATCHER_EVENTS: ReadonlySet<HookEvent> = new Set<HookEvent>([
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied',
]);

/** SessionStart/Setup only support command & mcp_tool handlers (CF111). */
export const SESSION_LIFECYCLE_EVENTS: ReadonlySet<HookEvent> = new Set<HookEvent>([
  'SessionStart', 'Setup',
]);

/** Known model aliases + representative IDs (CF403). Data-only; easy to extend. */
export const KNOWN_MODELS: ReadonlySet<string> = new Set([
  // aliases
  'opus', 'sonnet', 'haiku', 'fable',
  // representative IDs (kept loose; exact IDs evolve)
  'claude-opus-5', 'claude-sonnet-5', 'claude-fable-5', 'claude-haiku-4-5-20251001',
  'claude-opus-4-8', 'claude-opus-4-8[1m]',
]);

export function isHaiku(model: string | undefined): boolean {
  return !!model && /haiku/i.test(model);
}

/**
 * Matcher semantics (SPEC-CODEGEN "Matcher semantics reminder"):
 * only letters/digits/_/-/space/,/| are "literal"; anything else → regex.
 */
export function isLiteralMatcher(matcher: string): boolean {
  return /^[A-Za-z0-9_\-, |]*$/.test(matcher);
}

/**
 * A bare `mcp__<server>` matcher (no trailing `__.*`) is treated as an exact
 * literal and matches nothing, because real tool names are `mcp__server__tool`
 * (CF104).
 */
export function isBareMcpMatcher(matcher: string): boolean {
  // literal mcp__server with no third `__` segment and no regex wildcard.
  if (!/^mcp__/.test(matcher)) return false;
  if (!isLiteralMatcher(matcher)) return false;
  // mcp__server  → one "__" after mcp; mcp__server__.* would not be literal (has . and *)
  const rest = matcher.slice('mcp__'.length);
  return rest.length > 0 && !rest.includes('__');
}

/**
 * Heuristic for CF105: an unanchored tool-name regex that would over-match a
 * longer tool name (e.g. `Edit.*` also matches `NotebookEdit`… actually the
 * classic case is `Edit` matching `NotebookEdit` / `MultiEdit` as a substring).
 * We flag a regex matcher that is not anchored with ^…$.
 */
export function isUnanchoredRegexMatcher(matcher: string): boolean {
  if (isLiteralMatcher(matcher)) return false; // literal handled elsewhere
  const anchored = matcher.startsWith('^') && matcher.endsWith('$');
  return !anchored;
}

/** Default handler timeouts by handler type (REFERENCE: Hooks → timeout). */
export const DEFAULT_TIMEOUTS = {
  command: 600,
  http: 600,
  mcp_tool: 600,
  prompt: 30,
  agent: 60,
} as const;

/** Extract the executable/command token referenced by an embedded `` !`cmd` `` or arg. */
export function firstToken(command: string): string {
  return command.trim().split(/\s+/)[0] ?? '';
}

/** Does an `allowed-tools` list cover a Bash command token? (CF203) */
export function bashRuleCovers(allowedTools: readonly string[], cmdToken: string): boolean {
  return allowedTools.some((t) => {
    const m = /^Bash\(([^)]*)\)$/.exec(t.trim());
    if (!m) return t.trim() === 'Bash'; // bare Bash allows everything
    const pattern = m[1]!.trim();
    if (pattern === '' || pattern === '*') return true;
    // pattern like "git *" or "git status*" — its first whitespace-delimited
    // token is the command. Match the command token exactly (word boundary),
    // so an allow for `git` does NOT cover `github`.
    const ruleCmd = pattern.split(/\s+/)[0]!.replace(/\*$/, '');
    return cmdToken === ruleCmd;
  });
}
