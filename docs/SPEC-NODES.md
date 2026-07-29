# SPEC — Workflow Graph & Node Schema

The canvas edits a `WorkflowGraph`. Codegen consumes it and emits a Claude Code **dynamic
workflow** — a JavaScript orchestration script at `.claude/workflows/<slug>.js` (see
docs/REFERENCE-CLAUDE-CODE.md → "Dynamic workflows"). This is the single source of truth for
what users can express.

> **Pivot note (M6).** Earlier milestones (M0–M4) targeted `.claude/` *assets* (skills, subagents,
> hooks, settings.json). That collided with Claude Code's real `/workflows` feature. The graph now
> models a **workflow orchestration script**. The graph *envelope* (`WorkflowGraph`, `meta`, `edge`)
> is unchanged; the node union and codegen are new.

## Top level

```ts
interface WorkflowGraph {
  version: 1;
  meta: { name: string; slug: string; description?: string; ackedWarnings?: RuleId[] };
  settings: GlobalSettings;          // reserved; workflows have few global knobs (see below)
  nodes: WorkflowNode[];
  edges: Edge[];                     // { id, source, target, sourceHandle?, label? }
}

interface GlobalSettings {
  // Workflows are self-contained scripts; most former asset settings do not apply.
  // Reserved for future runtime hints. Kept for envelope stability.
}
```

`meta.slug` names the output file: `.claude/workflows/<slug>.js`. The `workflow.meta` node's
`name` becomes the emitted `export const meta.name` (the `/command` name). CF611 warns if they
disagree.

## Node union (discriminated on `kind`)

Every node: `{ id, kind, label, position: {x,y}, data: <per-kind> }`.

A workflow graph is a **DAG** rooted at the single `workflow.meta` node. Edges express data +
execution-order dependencies (`A → B` = "B runs after A and may consume A's result"). The DAG
linearizes to ordered `const … = await …` statements (topological order). Loops are a *node*
(`loopUntilCheck`), never a graph cycle; branches fan out via labeled edge ports.

### Result references

Fields that point at another node's result use a **`resultRef` = the producing node's id** (never
a raw variable name). Codegen owns the id → binding-name mapping, so the graph stays rename-stable.

Prompt/label strings may embed template refs, replaced at codegen with JS template-literal
interpolations against binding names:

| ref | resolves to |
|---|---|
| `{{nodeId}}` | the whole result of that node's binding |
| `{{nodeId.field.path}}` | a field of a schema-producing node's result |
| `{{args}}` | the runtime-provided `args` global |
| `{{item}}` | (inside `pipeline`) the current item |
| `{{check}}` | (inside `loopUntilCheck` fixPrompt) the checker's result |

### The six kinds

| kind | data | compiles to |
|---|---|---|
| `workflow.meta` | name, description, argsHint? | `export const meta = { name, description }` (unique root) |
| `agent` | prompt, schema? (JSON-Schema object), label?, model? | `const <bind> = await agent(`…`, { schema?, label?, model? })` |
| `pipeline` | source (resultRef), sourceField? (list field), itemPrompt, itemLabel?, itemSchema?, model? | `const <bind> = await pipeline(<sourceExpr>, item => agent(`…`, { label?, schema?, model? }))` |
| `branch` | source (resultRef), field (fieldPath), negate? | `if (<cond>) { …then arm… } else { …else arm… }` — two outgoing edges tagged `sourceHandle: "then"` / `"else"` |
| `loopUntilCheck` | checkPrompt, checkSchema?, passField='passed', fixPrompt, maxRounds=2, checkModel?, fixModel? | a bounded `while` loop (check → break on pass / no-progress → fix → repeat) |
| `output.return` | source (resultRef), field?, transform: 'none'\|'filterBoolean'\|'flatten' | `return <expr>;` (sink; last statement; exactly one) |

Notes:
- `workflow.meta` is the sole entry point (like a single primary trigger). Exactly one per graph.
- `agent` / `pipeline` / `loopUntilCheck` each produce exactly one `const` binding. `branch` and
  `output.return` produce no binding.
- `pipeline.source` must resolve to a list: either `args` (used as the array) or a schema-producing
  node's `sourceField` whose JSON-Schema `type` is `array` (CF607).
- `loopUntilCheck` expands to a `while` (a NODE), so `findCycle` still legitimately forbids graph
  cycles (CF603).
- Branch is the **strict form**: an arm's exclusive successors may not be referenced from outside
  that arm (CF609). A node both arms reach is a join, emitted after the `if/else`.

## Deterministic codegen

- **Binding names**: pure `bindingName(node)` = camelCase(`label` || `data.name` || `kind`) →
  sanitize to a valid identifier → collision-suffix by topological index. Deterministic.
- **Statement order**: stable topological sort (Kahn's; ties broken by edge position in
  `graph.edges`, then node id) — mirrors `codegen/model.ts` ordering.
- Embedded JSON-Schemas serialized via `stableJson` (recursive key-sort); fixed 2-space indent;
  single trailing newline; backticks / `${` in user prompts escaped. Output is snapshot-stable.

## HostBridge (canvas ↔ host contract)

```ts
interface HostBridge {
  writeFiles(files: GeneratedFile[], opts: {dryRun?: boolean}): Promise<WriteResult>;
  readProject(): Promise<WorkflowGraph | null>;  // for import/round-trip (sidecar-only)
  openFile(path: string): void;                   // vscode: open editor; web: preview modal
  pickDirectory?(): Promise<string | null>;       // web only
  notify(level: 'info'|'warn'|'error', msg: string): void;
}
```

Web implements it with the File System Access API (fallback: JSZip download).
VS Code implements it with `postMessage` ↔ extension host; writes go to
`${workspaceFolder}/.claude/workflows/…` with a diff/confirm view before applying.

### Round-trip

The emitted `.js` is **one-way output**. The `<slug>.clauflow.json` sidecar is the single
round-trip source of truth: `parseProject(generate(g))` reads the sidecar back to `g` (deep-equal
modulo positions). Codegen does NOT parse `.js` → graph (it's a full language; lossy).

## VS Code extension surface (packages/vscode)

- Custom editor for `*.clauflow.json` files (the saved graph) → opens the canvas webview.
- Commands: `claudeFlow.new`, `claudeFlow.import` (read the workspace sidecar), `claudeFlow.export`
  (generate + diff + write to `.claude/workflows/`), `claudeFlow.run` (open terminal — n/a for a
  script that runs via `/<name>`; reserved).
- Tree view "Claude Workflows": lists detected `.claude/workflows/*.js` (and their sidecars) in the
  workspace; click → import into canvas.
- Theme: consume `--vscode-*` CSS vars; never hardcode colors in canvas components.

## Validation rules

Rule catalog + severities live in docs/SPEC-VALIDATION.md. Structural rules CF001–CF008 are
retargeted for the workflow DAG; CF6xx are workflow-specific (meta, prompts, template refs,
pipeline source, branch/loop shape, return, model). Doc↔code parity is enforced by
`packages/core/test/validation-matrix.test.ts`.
