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

Two families: **CF0xx** structural rules over the workflow DAG (retargeted from the asset era but
still generic graph checks) and **CF6xx** workflow-script rules. RuleIds are stable — never renumber.

### Graph structure (CF0xx)
| ID | Sev | Rule | Quick fix |
|---|---|---|---|
| CF001 | error | Graph has nodes but no `workflow.meta` entry point | insert meta |
| CF002 | error | More than one `workflow.meta` node | — |
| CF003 | error | Cycle detected in the workflow DAG (use a loopUntilCheck node, not an edge loop) | — |
| CF004 | error | Orphan node (no path from `workflow.meta`) | delete / connect |
| CF005 | error | Edge connects incompatible kinds (per `edgeAllowed`) | — |
| CF006 | warn | Node has an empty required-for-quality field (label, meta description, agent prompt) | — |
| CF008 | warn | `workflow.meta.name` shadows a bundled command (`deep-research`, ...) | rename |

### Workflow script (CF6xx)
| ID | Sev | Rule | Quick fix |
|---|---|---|---|
| CF601 | error | No `workflow.meta` node, or more than one | insert / delete extras |
| CF602 | error | `workflow.meta.name` empty or not a valid `/command` slug | derive from graph.slug |
| CF604 | error | `agent`/`pipeline`/`parallel`/`loopUntilCheck` template prompt is empty (or neither prompt nor promptExpr set) | — |
| CF605 | error | Template ref `{{nodeId}}`/`{{nodeId.field}}` targets a node that doesn't exist, isn't upstream, or produces no binding | — |
| CF606 | error | Zero or more than one `output.return`, or a node exists downstream of the return | — |
| CF607 | error | `pipeline`/`parallel` source is not a list (missing `sourceField`, or field's JSON-Schema `type` ≠ array) | add / point `sourceField` |
| CF608 | error | `branch` without exactly one `then` and one `else` outgoing edge | — |
| CF609 | error | Branch-arm-exclusive node referenced from outside its arm (non-linearizable merge) | — |
| CF610 | warn | `loopUntilCheck` missing `checkPrompt`/`fixPrompt`, or `passField` absent from `checkSchema` | — |
| CF611 | warn | `workflow.meta.name` disagrees with graph `meta.slug` (file is `<slug>.js` but command is `/<name>`) | sync name↔slug |
| CF613 | warn | Unknown `model` string on an agent/pipeline/parallel/loop stage (not in known aliases/IDs) | — |
| CF614 | warn | `pipeline`/`parallel` fan-out with no `itemLabel` (harder to read the runtime feed) | generate label |
| CF615 | info | Downstream `.field` ref on an `agent` with no `schema` (structured output recommended) | add schema |
| CF616 | info | Graph contains a `raw` node — imported code kept verbatim (not modeled as typed nodes) | — |
| CF617 | error | `phase` node with an empty `title` | — |
| CF618 | error | `parentId` references a node that doesn't exist or isn't a `phase` | detach from parent |
| CF619 | info | `branch` uses a verbatim `condExpr` (structural view — best-effort re-export, not byte-identical) | — |

> CF007 (dup slug) is retired — a graph is one workflow; the meta.name↔slug concern is CF611.
> CF619 mirrors CF616's spirit for `branch`-from-`if`: it flags that the region re-exports in canonical
> form (fixpoint round-trip), not byte-identically to the author's source.

## Quick-fix framework

`QuickFix = { title: string; apply(graph): WorkflowGraph }` — pure graph transform,
tested like rules. The canvas renders it as a button in the problem row; VS Code also
surfaces it as a Code Action on `*.clauflow.json`.

## Coverage discipline

- `packages/core/test/validation-matrix.test.ts` asserts every RuleId in this doc has a
  registered rule and ≥2 fixtures (hit + miss). Doc and code drift fails CI.
- Every codegen emitter declares which rules make its output safe; the export gate
  refuses to run an emitter whose declared rules didn't execute (defense in depth).
