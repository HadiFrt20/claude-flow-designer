# REFERENCE — Claude Code Parameter Surface (research digest)

Verify against official docs when implementing: https://code.claude.com/docs/en/
(hooks, hooks-guide, skills, sub-agents, settings, permissions, model-config,
cli-reference, plugins, headless, mcp). Docs index: https://code.claude.com/docs/llms.txt

## Skill / slash-command frontmatter
`description`, `allowed-tools`, `argument-hint`, `model`, `context: fork`, `agent`,
`disable-model-invocation`, `hooks` (with `once: true` support).
Body: `$ARGUMENTS`, positional `$0..$n`, `` !`cmd` `` embedded shell output, `@file` refs.
Locations: `.claude/skills/<name>/SKILL.md` (modern; also auto-invocable),
`.claude/commands/*.md` and `~/.claude/...` (legacy, still supported). Subdirectory
namespacing shows in description. Skill descriptions share a context budget
(~2% of context window, fallback 16k chars; `SLASH_COMMAND_TOOL_CHAR_BUDGET` overrides).

## Subagents
`.claude/agents/<name>.md`, frontmatter: name, description, tools, model (+ hooks).
Own context window. `Stop` hooks in agent frontmatter auto-convert to `SubagentStop`.

## Hooks
Events (lifecycle order): SessionStart, Setup, InstructionsLoaded, UserPromptSubmit,
UserPromptExpansion, PreToolUse, PermissionRequest, PermissionDenied, PostToolUse,
PostToolUseFailure, PostToolBatch, Notification, MessageDisplay, SubagentStart,
SubagentStop, TaskCreated, TaskCompleted, Stop, StopFailure, TeammateIdle, ConfigChange,
CwdChanged, FileChanged, WorktreeCreate, WorktreeRemove, PreCompact, PostCompact,
Elicitation, ElicitationResult, SessionEnd.

Handler types: command, http, mcp_tool, prompt, agent (experimental).
Common fields: type, if (ONE permission rule, tool events only), timeout (defaults:
600 cmd/http/mcp, 30 prompt, 60 agent; UserPromptSubmit lowers to 30, MessageDisplay 10),
statusMessage, once (skill frontmatter only).
Command fields: command, args (exec form — preferred with path placeholders), async,
asyncRewake, shell (bash|powershell). HTTP: url, headers, allowedEnvVars.
MCP tool: server (plugin-scoped: `plugin:<plugin>:<server>`), tool, input with
`${tool_input.*}` substitution. Prompt/agent: prompt (`$ARGUMENTS` = input JSON), model.

Exit codes: 0 = success (stdout JSON parsed; plain stdout becomes context ONLY for
UserPromptSubmit/UserPromptExpansion/SessionStart). 2 = blocking (stderr fed to Claude;
JSON ignored). Other = non-blocking error. Exception: WorktreeCreate — any non-zero aborts.

JSON output universal fields: continue, stopReason, suppressOutput, systemMessage,
terminalSequence (allowlisted OSC 0/1/2/9/99/777 + BEL). hookSpecificOutput per event:
PreToolUse permissionDecision allow|deny|ask|defer (+ updatedInput);
PermissionRequest decision.behavior (+ updatedInput); PostToolUse updatedToolOutput;
PermissionDenied retry; MessageDisplay displayContent; SessionStart additionalContext,
initialUserMessage, sessionTitle, watchPaths, reloadSkills. additionalContext ≤10k chars
(overflow → file). CLAUDE_ENV_FILE writable from SessionStart/Setup/CwdChanged/FileChanged.
Input fields include: session_id, prompt_id, transcript_path, cwd, permission_mode,
effort.level (low|medium|high|xhigh|max; also $CLAUDE_EFFORT), hook_event_name,
agent_id/agent_type (subagent context), tool_name/tool_input/tool_use_id (tool events),
last_assistant_message (Stop/SubagentStop).

Hook locations/scopes: ~/.claude/settings.json, .claude/settings.json,
.claude/settings.local.json, managed policy, plugin hooks/hooks.json, skill/agent
frontmatter. `disableAllHooks` toggles all. `/hooks` menu is read-only.

## Settings.json (key subset)
model, effortLevel (low|medium|high accepted; max flaky — issues #30726/#45453, prefer CLI),
permissions {defaultMode, allow, deny, ask}, env, hooks, disableAllHooks, enabledPlugins,
outputStyle, statusLine, skipDangerousModePermissionPrompt.
Scopes: user → project → local → managed policy (highest).

## Permission modes
default (manual), plan (read-only), acceptEdits, auto, dontAsk, bypassPermissions.
Note: "Manual" arrives in hook input as "default".

## Effort
Levels low|medium|high|xhigh|max. Set via /effort, /model slider, `--effort` flag,
`effortLevel` setting, `ultrathink` keyword (one-turn high). Model and effort are
independent axes; warn on Haiku+max. Enterprise roles can cap effort per model
(requests above cap are clamped).

## CLI / headless
`claude -p "<prompt>"` non-interactive; flags: --model, --effort, --agent, --worktree,
--output-format text|json|stream-json, --max-turns (SDK), --verbose, --debug-file,
--resume/--continue/--fork-session, --init, --init-only, --maintenance (fire Setup hooks),
--enable-auto-mode. SDK: @anthropic-ai/claude-agent-sdk `query()` dispatches slash
commands; system/init message lists slash_commands.

## Env vars
CLAUDE_PROJECT_DIR, CLAUDE_PLUGIN_ROOT, CLAUDE_PLUGIN_DATA, CLAUDE_ENV_FILE,
CLAUDE_EFFORT, CLAUDE_CODE_REMOTE, SLASH_COMMAND_TOOL_CHAR_BUDGET.

## Plugins
Bundle: skills, subagents, commands, hooks (hooks/hooks.json), output styles, MCP server
definitions. `${user_config.*}` substitution (exec form only for hooks).
