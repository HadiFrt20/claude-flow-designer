# SPEC — Workflow Graph & Node Schema

The canvas edits a `WorkflowGraph`. Codegen consumes it. This is the single source of truth
for what users can express.

## Top level

```ts
interface WorkflowGraph {
  version: 1;
  meta: { name: string; slug: string; description?: string };
  settings: GlobalSettings;          // → settings.json + launch flags
  nodes: WorkflowNode[];
  edges: Edge[];                     // { id, source, target, sourceHandle?, label? }
}

interface GlobalSettings {
  model?: string;                    // e.g. "claude-opus-4-8", alias "sonnet"
  effort?: 'low'|'medium'|'high'|'xhigh'|'max';   // see REFERENCE: max not reliable in settings.json → emit CLI flag
  permissionMode?: 'default'|'plan'|'acceptEdits'|'auto'|'dontAsk'|'bypassPermissions';
  permissions?: { allow: string[]; deny: string[]; ask: string[] };
  env?: Record<string,string>;
  outputStyle?: string;
  disableAllHooks?: boolean;
  headless?: { enabled: boolean; outputFormat?: 'text'|'json'|'stream-json';
               maxTurns?: number; worktree?: boolean; verbose?: boolean };
}
```

## Node union (discriminated on `kind`)

Every node: `{ id, kind, label, position: {x,y}, data: <per-kind> }`.

### Triggers (graph entry points; exactly one primary trigger per exported workflow unit)
| kind | data | compiles to |
|---|---|---|
| `trigger.slashCommand` | name, description, argumentHint, args: {name, placeholder: '$0'\|'$1'\|'$ARGUMENTS'}[], disableModelInvocation, contextFork (bool), agent? (subagent ref), model?, effort? | `.claude/skills/<name>/SKILL.md` frontmatter + invocation |
| `trigger.hookEvent` | event (see CODEGEN table), matcher?, scope: 'user'\|'project'\|'local' | `hooks` block in the chosen settings.json |
| `trigger.sessionStart` | matcher: startup\|resume\|clear\|compact\|fork | SessionStart hook |
| `trigger.headless` | promptTemplate, schedule? (cron string, doc-only), initMode?: 'init'\|'init-only'\|'maintenance' | `run.sh` with `claude -p ...` |

### Steps
| kind | data |
|---|---|
| `step.prompt` | markdown body (supports `$ARGUMENTS`, `$0..$9`), model?, effort? |
| `step.shell` | command, embedOutput (→ `` !`cmd` `` in skill body) or standalone script |
| `step.fileRef` | paths[] (→ `@path` references) |
| `step.subagent` | name, description, tools[], model?, effort?, systemPrompt (md body) → `.claude/agents/<name>.md`; edge from a command node emits delegation instructions or frontmatter `agent:` |
| `step.mcpTool` | server, tool, input (object w/ `${tool_input.*}` substitution) — hook handler `type: mcp_tool` |

### Hook handlers (attach to a trigger.hookEvent via edge)
| kind | data |
|---|---|
| `hook.command` | command, args[] (exec form) or shell form, shell?: 'bash'\|'powershell', timeout?, statusMessage?, async?, asyncRewake?, once?, if? (permission-rule string) |
| `hook.http` | url, headers, allowedEnvVars[], timeout? |
| `hook.prompt` | prompt (uses `$ARGUMENTS` = input JSON), model? |
| `hook.agent` | prompt, model? (experimental — surface warning badge) |

### Control / output
| kind | data |
|---|---|
| `gate.condition` | matcher and/or `if` rule (e.g. `Bash(git *)`, `Edit(*.ts)`) — refines the hook it feeds |
| `output.decision` | mode: 'allow'\|'deny'\|'ask'\|'block'\|'stopAll', reason, updatedInput?, updatedToolOutput?, additionalContext?, systemMessage?, suppressOutput? — compiled into the generated hook script's JSON stdout (exit 0) or `exit 2` path |

## HostBridge (canvas ↔ host contract)

```ts
interface HostBridge {
  writeFiles(files: GeneratedFile[], opts: {dryRun?: boolean}): Promise<WriteResult>;
  readProject(): Promise<ExistingClaudeAssets | null>;  // for import/round-trip
  openFile(path: string): void;                          // vscode: open editor; web: preview modal
  pickDirectory?(): Promise<string | null>;              // web only
  notify(level: 'info'|'warn'|'error', msg: string): void;
}
```

Web implements it with File System Access API (fallback: JSZip download).
VS Code implements it with `postMessage` ↔ extension host; writes go to
`${workspaceFolder}/.claude/…` with a diff/confirm view before applying.

## VS Code extension surface (packages/vscode)

- Custom editor for `*.clauflow.json` files (the saved graph) → opens the canvas webview.
- Commands: `claudeFlow.new`, `claudeFlow.import` (parse existing `.claude/`),
  `claudeFlow.export` (generate + diff + write), `claudeFlow.run` (open terminal with the
  generated `claude` invocation).
- Tree view "Claude Workflows": lists detected skills/agents/hooks in the workspace; click →
  import into canvas.
- Theme: consume `--vscode-*` CSS vars; never hardcode colors in canvas components.

## Validation rules (initial set — extend in core/src/validate.ts)

- Blocking decision on an event that can't block (per CODEGEN exit-2 table) → error.
- `effort: max`/`xhigh` in settings.json → warn, suggest CLI flag (known flakiness).
- Haiku + xhigh/max effort → warn (wasteful pairing).
- Hook `if` on a non-tool event → error (never runs).
- Bare `mcp__server` matcher without `__.*` → error (matches nothing).
- Missing `jq` usage guard in generated scripts → codegen inserts a check automatically.
- Skill description > budget guidance → warn (skill descriptions share a ~2%-of-context /
  16k-char budget; keep them tight).
