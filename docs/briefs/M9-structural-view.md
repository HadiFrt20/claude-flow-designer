# Brief M9 — Structural view: phases as groups, real branches surfaced

## Objective
Make an imported workflow LOOK like its shape instead of a flat chain of blocks. Today a real
workflow renders as `meta → raw → raw → parallel → raw → …` — a straight line — even though the
author organized it into named phases with the occasional branch. M9 reconstructs that structure on
the canvas: **`phase('X')` markers become titled group containers** that wrap their steps, and the
handful of **`if` blocks that gate an agent call become `branch` nodes** (top-level *and* nested).

This is the pivot the user asked for after observing "it's all sequential — no loops, no branching."
The canvas becomes a read-oriented **structural view**; see the round-trip contract below for exactly
what that costs.

## Evidence (corpus of 73 real authored workflows under ~/.claude/projects/**/workflows/scripts)
Measured with acorn, not guessed. This reshaped the design away from the naive "parse if/for/while":

| construct | count | verdict |
|---|---|---|
| `phase('X')` bare markers | **176** | THE structuring primitive. Always a bare statement (0 awaited, 0 assigned). → group container. |
| `.then(v => …)` per-item shaping | 71 | Result-shaping on a fan-out; low value as its own node → annotation, stays inside the fan-out's expr. |
| `if` containing an agent/pipeline/parallel | **7** | Real orchestration branch → `branch` node (top-level + nested). |
| `if` (pure data-munging, no agent) | ~15 | Reducer logic → stays `raw` (unchanged). |
| `for/while` containing an agent | **0** | There are none. Loops are pure data-munging → stay `raw`. |
| top-level `if` / top-level `for-of` | 3 / 10 | Top-level control flow is nearly absent; the structure is phases + nesting. |

Worked example — the most phase-heavy workflow (`biorce-er-poc-build-wf`) today renders as one flat
chain; under M9 it renders as:
```
phase 'Understand'  ┐ agent: spec
phase 'Design'      ┤ parallel: designs
phase 'Build'       ┤ parallel: builds
phase 'Verify'      ┤ parallel: verdicts → branch(if failing) → agent: repair
phase 'Assemble'    ┘ parallel: [pocPlan, runbook] → agent: manifest
return
```

## Design decision (grounded, minimal, honest)
**Structural rule:** surface a construct as a structural node ONLY when it structures *orchestration*
(directly contains an `agent`/`pipeline`/`parallel`/`phase` call). Pure data-munging `if`/`for`/`while`
stays `raw`, exactly as today — we do not pretend to model arbitrary JS.

Two new modeling primitives, deliberately small:
1. **`phase` group node** (the big, safe win — 176 uses). `phase('X')` opens a group; every following
   top-level statement belongs to it until the next `phase(...)` or end. Rendered as a titled container
   (React Flow parent node). Members carry `parentId`.
2. **`branch` from a real `if`** that gates orchestration (7 uses). The existing `branch` kind already
   models `then`/`else`; M9 makes the *parser* create it from real `if` blocks (previously only codegen's
   own exact shape parsed back). Applies at top level and nested inside phase/callback/if bodies.

`.then(…)` collect callbacks stay part of the fan-out node's verbatim expression (they already survive
as `promptExpr`/raw); not a separate node.

## Round-trip contract (this is what "structural view" costs — stated honestly)
Clarification from reading the code: **source byte-identity was ALWAYS a property of the gallery
fixtures only** (scripts the emitter itself produced), never of arbitrary real workflows. M7/M8 already
re-emit a real workflow like ironclad in the emitter's canonical style — "valid + self-lint-passing,"
not byte-for-byte the author's formatting. M9 keeps three explicit, tested levels:

1. **Graph round-trip (both new kinds)** — `parse(emit(graph))` deep-equals `graph` (modulo node
   positions). THE property test. Must hold for `phase` groups AND `branch`-from-`if`.
2. **Source byte-identity (gallery fixtures)** — `emit(parse(source)) === source` for canonical scripts
   the emitter produced, INCLUDING a new phase-grouped gallery fixture and every M6–M8 fixture (no
   regression). Not claimed for arbitrary real workflows (never was).
3. **Real-workflow fidelity (fixpoint)** — for an arbitrary imported workflow, `emit(parse(src))` is
   valid + self-lint-passing, and **idempotent**: `emit(parse(emit(parse(src)))) === emit(parse(src))`
   (re-import/re-export reaches a fixpoint after one round — no drift). This is what replaces the
   impossible "byte-identical arbitrary source" claim for `branch` regions, which the user accepted.

## Branch conditions: verbatim `condExpr` (the M8 `promptExpr` move, applied to `if`)
Real `if` conditions in the corpus (`if (failing.length)`, `if (!findings)`, `if (r?.passed)`) do NOT
fit `branch`'s narrow `{source, field, negate}` model. So — exactly as M8 gave agents a verbatim
`promptExpr` for programmatic prompts — `branch` gets an optional **`condExpr`**: the verbatim JS
condition, emitted as-is inside `if (<condExpr>) { … }`, self-lint-exempt (its identifiers are opaque
user code, like a raw region). Structured `{source, field, negate}` stays the authoring path; `condExpr`
is the import/visualization path. Exactly one is used (parser sets `condExpr`; codegen prefers it). This
keeps us honest: we mirror the author's condition back rather than inventing a structured approximation.

## In scope
- **`phase` group node kind** (`schema/nodes.ts`): `{ title: string }`; + optional `parentId` on the node
  base for containment. NODE_KINDS drift-pin updated.
- **Parser** (`import-js.ts`): recognize `phase('X')` → open a group; assign `parentId` to subsequent
  members; recurse into `if` consequent/alternate and arrow/callback block bodies to surface nested
  `branch` (and nested phases/agents) when they gate orchestration. Non-orchestration `if`/`for` → raw.
- **Codegen** (`codegen/workflow.ts`): emit `phase('X')` before a group's members; emit parsed branches
  as `if/else`. Add `phase` to self-lint GLOBALS. Tier-1 stays byte-identical.
- **Validation** (`rules/workflow.ts`): CF617 phase title non-empty; CF618 parentId references an existing
  `phase` node; CF619 (info) branch parsed from a non-canonical `if` is a Tier-2 structural region. Matrix
  parity + SPEC-VALIDATION updated.
- **Canvas** (`fields.ts` + node rendering): `phase` palette entry + fields; render as a titled group box
  containing its children; layout nests children within the group. Branch ports already render.
- **DoD per node kind** (CLAUDE.md): zod + codegen + snapshot + rule + panel + round-trip for `phase`.

## Out of scope (stays `raw`, verbatim, unchanged)
- `for`/`while`/`do-while` bodies (0 contain agents in the corpus — pure data-munging).
- `if` blocks that don't gate an agent/pipeline/parallel (reducer logic).
- `.then()` collect callbacks as standalone nodes (kept in the fan-out expression).
- `Promise.all` (3 uses), `log()` side-effects — remain raw.
- Editing-first fidelity for Tier-2 regions (we guarantee fixpoint idempotence, not byte-identity).

## Acceptance
- All 5–6 gallery scripts + every M8 fixture STILL round-trip **byte-identical** (Tier-1 no regression).
- A `phase`-grouped fixture round-trips **byte-identical** (marker + members).
- A nested-`if`-gating-an-agent fixture parses to a `branch` node and satisfies the **fixpoint**
  property (emit∘parse idempotent after one round).
- `biorce-er-poc-build-wf` (or an equivalent phase-heavy real workflow) imports with its phases as
  group containers and its verify-branch as a `branch` node; `generate()` re-emits valid,
  self-lint-passing JS.
- Corpus re-run: phase groups > 0 and branch nodes > 0 across the 73 workflows (was 0/0); still 0 hard
  errors.
- New `phase` kind: zod + codegen + snapshot + validation rule(s) + panel field + round-trip.
- `npm run gate` + `npm run lint` green; fixtures drift-clean; code-reviewer APPROVE.
