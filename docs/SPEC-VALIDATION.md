# SPEC — Validation & Export Gate

Validation is a first-class subsystem, not a helper. It runs in three places with the SAME
rule engine from `packages/core/src/validate.ts`:

1. **Live** — on every graph edit; inline node badges + Problems panel (both hosts).
2. **Export gate** — `generate()` refuses to emit files while any `error` exists.
   Warnings require explicit acknowledgment (checkbox per warning in the export dialog;
   acks stored in the graph file as `meta.ackedWarnings: RuleId[]` so they persist and
   show up in git diffs / PR review).
3. **CI** — `clauflow validate <file.clauflow.json>` (core exposes a tiny CLI) so saved
   graphs in a repo are gated in pipelines too.

## Engine contract

```ts
type Severity = 'error' | 'warn' | 'info';
interface Diagnostic {
  ruleId: RuleId;           // stable, documented below — never renumber
  severity: Severity;
  nodeId?: string;          // omit for graph-level
  field?: string;           // property-panel highlight target
  message: string;
  quickFix?: QuickFix;      // machine-applicable edit, shown as a button
  docsUrl?: string;         // link into docs/REFERENCE-CLAUDE-CODE.md or official docs
}
type Rule = (graph: WorkflowGraph) => Diagnostic[];
```

Rules are pure, ordered, and individually unit-tested (one fixture graph per rule that
triggers it, one that doesn't). Adding a node property without touching this catalog is a
review blocker (see SPEC-REVIEW.md).

## Rule catalog

### Graph structure (CF0xx)
| ID | Sev | Rule | Quick fix |
|---|---|---|---|
| CF001 | error | Workflow unit has no trigger node | insert trigger |
| CF002 | error | More than one primary trigger in a unit | — |
| CF003 | error | Cycle detected in step chain | — |
| CF004 | error | Orphan node (no path from a trigger) | delete / connect |
| CF005 | error | Edge connects incompatible kinds (e.g. hook handler → slash command) | — |
| CF006 | warn | Node has empty required-for-quality field (description, label) | — |
| CF007 | error | Duplicate slug across slash commands / subagent names | rename |
| CF008 | warn | Slash command name shadows a bundled skill (`code-review`, `verify`, ...) | rename |

### Hooks (CF1xx)
| ID | Sev | Rule | Quick fix |
|---|---|---|---|
| CF101 | error | Blocking decision (`block`/`deny`/exit-2 tail) on a non-blockable event (per BLOCKABLE_EVENTS) | switch to side-effect output |
| CF102 | error | `if` condition on a non-tool event (hook would never run) | remove `if` |
| CF103 | error | `matcher` set on an event that ignores matchers (UserPromptSubmit, Stop, PostToolBatch, ...) | remove matcher |
| CF104 | error | Bare `mcp__<server>` matcher (exact-match chars only ⇒ matches nothing) | append `__.*` |
| CF105 | warn | Unanchored regex matcher that over-matches (e.g. `Edit.*` also hits `NotebookEdit`) | anchor `^...$` |
| CF106 | error | Hook handler references a path placeholder in shell form without quotes | switch to exec form (`args`) |
| CF107 | warn | `once: true` outside skill frontmatter (ignored there) | remove |
| CF108 | warn | UserPromptSubmit handler with timeout > 30s default (stalls every prompt) | lower timeout |
| CF109 | warn | MessageDisplay handler with timeout > 10s | lower timeout |
| CF110 | warn | `hook.agent` used — experimental; require explicit ack (warn so the export gate lets the user ack it, like CF404) | — |
| CF111 | error | SessionStart/Setup handler of type `http`/`prompt`/`agent` (only command & mcp_tool supported) | change type |
| CF112 | warn | mcp_tool hook on SessionStart/Setup (server likely not connected yet) | — |
| CF113 | error | PermissionDenied hook using exit 2 (ignored) instead of JSON `retry` | convert |
| CF114 | warn | Hook relies on exit code 1 to block (only 2 blocks; 1 = non-blocking) | change to exit 2 |
| CF115 | error | `hook.command.scriptBody` is a full script (leading `#!`) instead of inner logic — codegen owns the shebang + jq guard + stdin read, so a pasted full script bypasses them | strip the shebang/header |

### Skills / commands (CF2xx)
| ID | Sev | Rule | Quick fix |
|---|---|---|---|
| CF201 | error | Positional placeholder `$N` used with no matching arg definition | add arg |
| CF202 | warn | `argument-hint` missing while args are used | generate hint |
| CF203 | error | `` !`cmd` `` present but command not covered by `allowed-tools` Bash rule | add `Bash(<cmd> *)` |
| CF204 | warn | Skill description over budget guidance (~keep < 200 chars; global budget 2% ctx / 16k) | — |
| CF205 | error | `agent:` frontmatter references unknown subagent node | — |
| CF206 | warn | `disable-model-invocation` + vague description (dead weight in context) | — |
| CF207 | error | `@file` reference to path that is graph-declared as generated output (ordering hazard) | — |

### Subagents (CF3xx)
| ID | Sev | Rule | Quick fix |
|---|---|---|---|
| CF301 | error | Subagent `tools` includes a tool not in the workflow's allow set | — |
| CF302 | warn | Subagent without description (Claude can't auto-delegate) | — |
| CF303 | warn | `Stop` hook in agent frontmatter (auto-converted to SubagentStop — inform) | — |

### Settings / model / effort (CF4xx)
| ID | Sev | Rule | Quick fix |
|---|---|---|---|
| CF401 | warn | `effort: xhigh\|max` targeted at settings.json (flaky; issues #30726/#45453) | move to CLI flag (codegen does this automatically; warn explains) |
| CF402 | warn | Haiku + xhigh/max effort (wasteful pairing) | suggest model/effort |
| CF403 | error | Unknown model string (not in known aliases/IDs list; list is data, easy to update) | — |
| CF404 | warn | `bypassPermissions` mode in an exported workflow (require ack) | — |
| CF405 | error | Permission rule syntax invalid (parser in core) | — |
| CF406 | warn | `deny` rule shadowed by broader `allow` (allow/deny precedence explainer) | — |
| CF407 | error | env var name invalid / reserved (`CLAUDE_*` warn, `OTEL_*` stripped from subprocesses) | rename |

### Headless / runner (CF5xx)
| ID | Sev | Rule | Quick fix |
|---|---|---|---|
| CF501 | error | Headless trigger without prompt template | — |
| CF502 | warn | `--output-format stream-json` consumed by nothing downstream | — |
| CF503 | warn | `--max-turns` low for a multi-step workflow (heuristic: < steps × 2) | — |
| CF504 | info | Worktree enabled — remind about WorktreeCreate hook interaction | — |

## Quick-fix framework

`QuickFix = { title: string; apply(graph): WorkflowGraph }` — pure graph transform,
tested like rules. The canvas renders it as a button in the problem row; VS Code also
surfaces it as a Code Action on `*.clauflow.json`.

## Coverage discipline

- `packages/core/test/validation-matrix.test.ts` asserts every RuleId in this doc has a
  registered rule and ≥2 fixtures (hit + miss). Doc and code drift fails CI.
- Every codegen emitter declares which rules make its output safe; the export gate
  refuses to run an emitter whose declared rules didn't execute (defense in depth).
