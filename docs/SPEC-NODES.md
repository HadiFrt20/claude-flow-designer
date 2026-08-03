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
  model?: string; // default model for agent/pipeline/loop stages that route none of their own
  env?: Record<string, string>; // reserved runtime env hints (not emitted into the .js today)
}
```

`meta.slug` names the output file: `.claude/workflows/<slug>.js`. The `workflow.meta` node's
`name` becomes the emitted `export const meta.name` (the `/command` name). CF611 warns if they
disagree.

## Node union (discriminated on `kind`)

Every node: `{ id, kind, label, position: {x,y}, parentId?, data: <per-kind> }`.

`parentId` (M9) is an optional containment pointer: when set, it is the id of a `phase` node that
visually and structurally CONTAINS this node. It is orthogonal to `edges` (which carry execution
order) — a member of a phase is still wired into the linear/branch edge flow; `parentId` only groups
it under a titled container on the canvas and emits a `phase('…')` marker before the group's members.
Only a `phase` node may be a parent; phases do not nest inside phases (single level — matches the
corpus, where `phase()` markers are flat).

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

### The ten kinds

| kind | data | compiles to |
|---|---|---|
| `workflow.meta` | name, description, argsHint? | `export const meta = { name, description }` (unique root) |
| `phase` | title | `phase(<title>)` marker; groups the nodes whose `parentId` is this node (M9) |
| `fanout` | mode: 'parallel'\|'pipeline', binding?, branches: FanoutBranch[] | `const <bind> = await parallel([ …branch thunks / …map spreads ])` (M10) — a heterogeneous concurrent group |
| `agent` | prompt, schema? (JSON-Schema object), label?, model?, extraOpts? | `const <bind> = await agent(`…`, { schema?, label?, model?, …extraOpts })` |
| `pipeline` | source (resultRef), sourceField? (list field), itemPrompt, itemLabel?, itemSchema?, model?, extraOpts? | `const <bind> = await pipeline(<sourceExpr>, item => agent(`…`, { … }))` |
| `parallel` | source (resultRef), sourceField?, itemVar='item', itemPrompt, itemLabel?, itemSchema?, model?, extraOpts? | `const <bind> = await parallel(<sourceExpr>.map(<itemVar> => () => agent(`…`, { … })))` |
| `branch` | source (resultRef), field (fieldPath), negate? — OR verbatim `condExpr` | `if (<cond>) { …then arm… } else { …else arm… }` — two outgoing edges tagged `sourceHandle: "then"` / `"else"` |
| `loopUntilCheck` | checkPrompt, checkSchema?, passField='passed', fixPrompt, maxRounds=2, checkModel?, fixModel? | a bounded `while` loop (check → break on pass / no-progress → fix → repeat) |
| `output.return` | source (resultRef), field?, transform: 'none'\|'filterBoolean'\|'flatten' | `return <expr>;` (sink; last statement; exactly one) |
| `raw` | code (verbatim JS), produces? (binding names it declares) | the `code`, emitted UNCHANGED at its topo position |

Notes:
- `workflow.meta` is the sole entry point (like a single primary trigger). Exactly one per graph.
- `agent` / `pipeline` / `parallel` / `loopUntilCheck` each produce exactly one `const` binding.
  `branch`, `phase`, and `output.return` produce no binding.
- `phase` (M9) models the corpus's dominant structuring primitive (`phase('X')`, 176 uses): a bare
  runtime marker that names the following block of work. It emits a `phase(<title>)` statement before
  its members (the nodes with `parentId === this.id`, in topo order) and renders as a titled group
  container. `phase` produces no binding and takes no result ref. Phases are flat (no nesting).
- `branch.condExpr` (M9) is the verbatim-condition escape hatch, mirroring M8's `agent.promptExpr`: a
  real imported `if (failing.length)` / `if (!findings)` types as a `branch` with `condExpr` set to the
  verbatim JS condition (emitted as-is, self-lint-exempt) rather than dropping the whole `if` to `raw`.
  Exactly one of `{source, field}` (structured) or `condExpr` (verbatim) is set; codegen prefers
  `condExpr`. Only `if` blocks that GATE orchestration (contain an agent/pipeline/parallel/phase) become
  branches; pure data-munging `if`/`for`/`while` stay `raw`.
- `parallel` (M8) is the corpus's dominant concurrency primitive — `parallel(ARRAY.map(v => () =>
  agent(...)))`, one agent per item run concurrently. It preserves the `.map` param name (`itemVar`,
  not always `item`) so it round-trips exactly. Same list-source rules as `pipeline` (CF607).
- `fanout` (M10) models the **static-array** concurrency form `parallel([ … ])`, which `parallel`
  (single mapped source) cannot express: its array is HETEROGENEOUS — each element is either a literal
  thunk `() => agent(prompt, opts)` or a spread `...SOURCE.map(v => () => agent(...))`, and several may
  be merged into one concurrent group. It renders as a titled container with **one lane per branch**
  (a `map` branch's lane is labelled `× <source>` since its width is runtime-dynamic; a `thunk` branch
  is one concrete lane), making the real fan-out visible instead of collapsing 2–16 concurrent agents
  into one box. `branches: FanoutBranch[]` where each branch is one of:
  - `{ kind: 'map', source, sourceField?, itemVar, itemPrompt|itemPromptExpr, itemLabel?, itemSchema?, model?, extraOpts? }` — a `...SRC.map(v => () => agent())` spread.
  - `{ kind: 'thunk', prompt|promptExpr, label?, schema?, model?, extraOpts? }` — a literal `() => agent()`.
  `mode` is `parallel` (concurrent; also models `Promise.all`) or `pipeline`. Produces one `const`
  binding (`binding` name preserved on round-trip). The existing single-source `parallel`/`pipeline`
  kinds are unchanged (they still handle `parallel(SRC.map(...))` and `pipeline(...)`); `fanout` covers
  only the array form those two can't represent.
- `extraOpts` (M8) is a passthrough map of undocumented-but-real agent opts (`phase`, `effort`,
  `agentType`, …) whose values are verbatim JS source, emitted after the modeled opts. It lets a real
  hand-authored `agent(prompt, { label, phase, effort })` type instead of falling to `raw`.
- `raw` (M7) is the **import escape hatch**: top-level statements the JS→graph importer can't model
  as typed nodes (schema consts, helper functions, `for` loops, `Promise.all`, complex returns) are
  preserved verbatim in a `raw` node. `produces` lists the bindings it declares so downstream typed
  nodes/refs resolve; a `raw` block whose code contains a top-level `return` is itself a valid sink
  (CF606). Codegen emits `code` unchanged, so an imported workflow re-exports faithfully.
- `pipeline.source` must resolve to a list: either `args` (used as the array) or a schema-producing
  node's `sourceField` whose JSON-Schema `type` is `array` (CF607).
- `loopUntilCheck` expands to a `while` (a NODE), so `findCycle` still legitimately forbids graph
  cycles (CF003).
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

Import parses a real `.claude/workflows/<name>.js` INTO an editable graph (M7); the sidecar is a
derived projection, not the source of truth. The round-trip contract has three levels (M9 states them
explicitly; earlier milestones only ever guaranteed level 2 for gallery fixtures):

1. **Graph round-trip** — `parse(emit(g))` deep-equals `g` (modulo node positions). The property test
   for every kind, including `phase` groups and `branch`-from-`if`.
2. **Source byte-identity (canonical scripts)** — `emit(parse(src)) === src` for scripts the emitter
   produced (the gallery fixtures + a phase-grouped fixture). NOT claimed for arbitrary hand-authored
   source (never was): the emitter re-formats in its canonical style.
3. **Real-workflow fidelity (fixpoint)** — for an arbitrary imported workflow, `emit(parse(src))` is
   valid + self-lint-passing and **idempotent** (`emit(parse(emit(parse(src)))) === emit(parse(src))`).
   Structured regions (`branch` from a hand-authored `if`) re-emit in canonical form; re-import/re-export
   reaches a fixpoint after one round.

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
