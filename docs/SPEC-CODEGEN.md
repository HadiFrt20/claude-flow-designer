# SPEC — Code Generation Mapping

`generate(graph: WorkflowGraph): GeneratedFile[]` in `packages/core/src/codegen/`.
Deterministic output (stable key ordering, trailing newline) so snapshot tests and VS Code
diffs are clean.

## Output layout

```
.claude/
  skills/<slug>/SKILL.md        # per trigger.slashCommand (preferred modern format)
  agents/<name>.md              # per step.subagent
  hooks/<event>-<n>.sh          # per hook.command with a script body
  settings.json                 # project scope: hooks blocks, permissions, model, env...
  settings.local.json           # only if user marks items "local"
run.sh                          # if settings.headless.enabled or trigger.headless present
flow.clauflow.json              # the saved graph itself (round-trip source of truth)
```

Optional export target: plugin bundle (`plugin.json` + `skills/ agents/ hooks/hooks.json`).

## Slash command / skill mapping

Graph path: `trigger.slashCommand → (step.shell | step.fileRef | step.prompt | step.subagent)*`
compiles to ONE `SKILL.md`, sections in edge order.

Frontmatter emitted (omit empty):
```yaml
---
description: <required, keep short — shares the skill-description char budget>
allowed-tools: Read, Grep, Bash(git *)   # union of tools required by connected steps
argument-hint: "[issue-number] [priority]"
model: <node.model>
context: fork            # if contextFork
agent: <name>            # if delegating whole command to a subagent
disable-model-invocation: true
hooks: { <event>: [...] }        # per-skill hooks, supports once: true
---
```
Body composition rules:
- `step.shell` with embedOutput → `` !`<command>` `` inline under a `## Context` heading.
- `step.fileRef` → `@path` lines.
- `step.prompt` → verbatim markdown; placeholders `$ARGUMENTS`, `$0..$9` preserved.
- `step.subagent` mid-flow → instruction line: "Use the <name> subagent to <description>".

## Subagent mapping → `.claude/agents/<name>.md`

```yaml
---
name: <name>
description: <when Claude should delegate to it>
tools: Read, Grep, Glob        # omit → inherits all
model: <model or omit>
---
<systemPrompt body>
```

## Hooks mapping → settings.json `hooks` block

```json
{ "hooks": { "<Event>": [ { "matcher": "<m>", "hooks": [ <handler>... ] } ] } }
```
Handler emission by node kind:
- `hook.command` → `{type:"command", command, args?, timeout?, statusMessage?, async?,
  asyncRewake?, shell?, if?, once?}`. If the node has a script body, write
  `.claude/hooks/<file>.sh` (chmod +x) and reference via `${CLAUDE_PROJECT_DIR}/...` in
  EXEC FORM (`args: []` minimum) to avoid quoting bugs.
- `hook.http` → `{type:"http", url, headers?, allowedEnvVars?, timeout?}`.
- `hook.prompt` → `{type:"prompt", prompt, model?}`. `hook.agent` → `{type:"agent", ...}`.
- `step.mcpTool` as handler → `{type:"mcp_tool", server, tool, input}`.

### Decision output → script body

`output.decision` connected downstream of a hook determines the generated script's tail:
| mode | emission |
|---|---|
| deny (PreToolUse) | exit 0 + JSON `hookSpecificOutput.permissionDecision: "deny"` + reason |
| allow / ask / defer | same shape with respective value |
| block (top-level events) | JSON `{"decision":"block","reason":...}` OR `echo reason >&2; exit 2` (user picks style; default JSON) |
| stopAll | `{"continue": false, "stopReason": ...}` |
| updatedInput / updatedToolOutput / additionalContext / systemMessage / suppressOutput | merged into the JSON object |

### Blockability table (validation source of truth)

Can block via exit 2 / decision: PreToolUse, PermissionRequest, UserPromptSubmit,
UserPromptExpansion, Stop, SubagentStop, TeammateIdle, TaskCreated, TaskCompleted,
ConfigChange, PostToolBatch, PreCompact, Elicitation, ElicitationResult, WorktreeCreate
(any non-zero).
Cannot block (side-effect only): PostToolUse*, PermissionDenied (JSON `retry:true` only),
Notification, SubagentStart, SessionStart, Setup, SessionEnd, CwdChanged, FileChanged,
PostCompact, WorktreeRemove, InstructionsLoaded, StopFailure, MessageDisplay (display-only).
(*PostToolUse exit 2 shows stderr to Claude but the tool already ran.)

### Matcher semantics reminder
Letters/digits/`_`/`-`/space/`,`/`|` → exact / list. Anything else → unanchored JS regex.
MCP: `mcp__<server>__.*`; plugin-scoped: `mcp__plugin_<plugin>_<server>__.*`.

## GlobalSettings mapping

| field | destination |
|---|---|
| model | settings.json `"model"` AND `--model` in run.sh |
| effort low/medium/high | settings.json `"effortLevel"` |
| effort xhigh/max | run.sh `--effort <lvl>` ONLY + comment explaining why (settings flakiness); canvas shows warn badge |
| permissionMode | settings.json `permissions.defaultMode` |
| permissions.allow/deny/ask | settings.json `permissions` |
| env | settings.json `"env"` |
| outputStyle / disableAllHooks | settings.json keys |
| headless.* | run.sh: `claude -p "<prompt>" [--model][--effort][--worktree][--output-format][--max-turns][--verbose]`; initMode → `--init` / `--init-only` / `--maintenance` |

## Generated script conventions

- Shebang `#!/bin/bash`, `set -euo pipefail` where safe.
- First lines: `command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }`.
- Read stdin once: `input=$(cat)`; extract with `jq -r`.
- Must pass shellcheck in CI.

## Importer (round-trip)

`parseProject(files) → WorkflowGraph`: read `.claude/skills/**/SKILL.md`,
`.claude/commands/*.md` (legacy — import supported, export always modern),
`.claude/agents/*.md`, hooks blocks from all three settings scopes, `run.sh` flag sniffing.
Unknown frontmatter keys are preserved in `data.extra` and re-emitted verbatim.
