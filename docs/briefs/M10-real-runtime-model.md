# Brief M10 — Rebuild the importer around the REAL runtime model

## Why (the correction)
Through M6–M9 the importer only recognized the exact syntactic shapes our OWN emitter produces
(`parallel(SOURCE.map(v => () => agent()))`, canonical `if`, etc.) and flattened everything else to
`raw`. Result: imported workflows still looked sequential. Re-grounding against the source of truth —
the Claude Code runtime binary (v2.1.220) and https://code.claude.com/docs/en/workflows — shows the
model is broader than our emitter dialect. The docs are explicit: *"A workflow script holds the loop,
the branching, and the intermediate results itself."* Loops/branches are plain JS; concurrency is
`parallel(...)`/`pipeline(...)`.

### Verified runtime facts (from the binary + docs, not assumptions)
- The VM sandbox injects exactly these globals (found in the runtime's context builder):
  `agent`, `parallel`, `pipeline`, `workflow` (sub-workflow invocation), `phase`, `log`, `console`,
  `budget`, `args`, `setTimeout`, `clearTimeout`.
- `agent(prompt, opts?)` → one subagent; `pipeline(items, fn)` → one per item; `parallel(...)` →
  concurrent (≤16 at once, 1000/run cap).
- Loops/branches are plain JS `for`/`while`/`if`; the canonical loop example is a `while` that keeps
  fixing until a check passes.

## Census of the 73-workflow corpus (what the model MUST cover — measured, with counts)
| construct | count | today | M10 target |
|---|---|---|---|
| `parallel(SOURCE.map(v => () => agent()))` | 93 | typed, 1 box | typed + rendered as N lanes |
| `parallel([ …thunks / …spreads ])` static array | **18 (57 agents)** | **raw (invisible)** | **typed fan-out, N lanes** |
| `pipeline(items, fn)` | 12 | typed | typed + lanes |
| `if` gating agent/parallel (nested in callbacks) | 6 | raw | branch node (recurse into callbacks) |
| `if` gating agent (top-level) | 1 | branch (M9) | unchanged |
| `.then(v => …)` result-shaping on a fan-out | 67 | inside the fan-out expr | stays inside the expr (annotation) |
| `phase('X')` | 169 | phase group (M9) | unchanged |
| `Promise.all([...])` | 3 | raw | fan-out (same lane treatment) |
| `workflow(name, args)` sub-workflow call | **0** | — | model minimally (schema + emit), no corpus case |
| `while`-with-agent / nested `for`-with-agent | **0** | raw | leave raw (absent; don't over-build) |

Key finding: the static-array `parallel([...])` is **heterogeneous** — elements are literal thunks
`() => agent(...)` AND spreads `...SRC.map(r => () => agent(r.prompt, opts))`, sometimes several
source arrays merged into one concurrent group. This is where 57 agents currently vanish into `raw`.

## The new node model (schema)
A fan-out is no longer a single node whose item-agent is a hidden expression. It becomes a **group
with explicit branch members** so the canvas can draw the lanes and codegen can re-emit faithfully.

- **`fanout` node kind** (supersedes the M8 `parallel`/`pipeline` single-node model for import; the old
  kinds stay valid for authoring + round-trip of existing fixtures):
  - `mode: 'parallel' | 'pipeline'` (concurrent vs one-per-item) — also covers `Promise.all` (parallel).
  - `branches: FanoutBranch[]` where each branch is EITHER:
    - `{ kind: 'map', source: resultRef, sourceField?, itemVar, itemPrompt|itemPromptExpr, itemLabel?, itemSchema?, model?, extraOpts? }` (a `...SRC.map(v => () => agent())` spread), OR
    - `{ kind: 'thunk', prompt|promptExpr, label?, schema?, model?, extraOpts? }` (a literal `() => agent()`).
  - Each branch renders as one lane; a `map` branch's lane is labelled `× <source>` (dynamic width),
    a `thunk` branch is a single concrete lane.
  - Members are children on the canvas (parentId), exactly like phase containment.
- Keep `branch` (M9, incl. `condExpr`) and extend the parser to recurse into `parallel`/`pipeline`
  callback BLOCK bodies and `.then()` callbacks so an `if` gating an agent inside them becomes a branch.
- `workflow(name, args)` → a small `subworkflow` node (name + verbatim args expr). No corpus case, so:
  schema + codegen + one snapshot, not a deep feature.

## Round-trip contract (unchanged tiers from M9, restated)
1. **Graph round-trip**: `parse(emit(g))` deep-equals `g` (positions modulo). Holds for every new kind.
2. **Byte-identity**: gallery fixtures (incl. a new `fanout` fixture) + all M6–M9 fixtures re-emit
   byte-identical.
3. **Fixpoint**: arbitrary imported workflow `emit(parse(src))` is valid + self-lint-passing +
   idempotent. This replaces "byte-identical arbitrary source" for the newly-structured regions.

## In scope
- Schema: `fanout` kind + `FanoutBranch` union; `subworkflow` kind; keep existing kinds.
- Parser: type static-array `parallel([...])` (thunks + `.map` spreads + merged arrays); both fan-out
  forms → `fanout` with lane branches; recurse into fan-out/`.then()` callback bodies for nested `if`.
- Codegen: emit `fanout` back to the exact `parallel([...])` / `parallel(SRC.map(...))` / `pipeline(...)`
  it came from (byte-identical for our own output); `subworkflow` → `await workflow(name, args)`.
- Self-lint: exempt each branch's verbatim promptExpr span (generalize the existing anchor mechanism).
- Validation: fan-out branch rules (non-empty prompt per branch; source resolvable; ≥1 branch) with
  matrix parity; renumber into CF62x.
- Canvas: render `fanout` as a titled concurrent/sequential container with N lanes (one per branch),
  reusing the M9 fan-out visual; palette + fields + defaultData.
- DoD per new kind: zod + codegen + snapshot + rule + panel + round-trip.

## Out of scope (measured absent or low-value)
- `while` loops / nested `for` loops wrapping agents (0 in corpus) — stay `raw`.
- `.then()` as a standalone node (67, but pure per-item result-shaping) — stays inside the fan-out expr.
- `subworkflow` / `workflow()` sub-workflow node — **DEFERRED, not built**: 0 corpus cases, so adding a
  kind + codegen + rule + panel + fixture would be speculative over-building. Left as `raw` (it round-
  trips verbatim) until a real case appears. (Earlier brief draft said "minimal node"; corrected to 0.)

## Acceptance
- Corpus re-run: the 57 agents currently hidden in static-array `parallel([...])` are now visible as
  fan-out lanes; every workflow with a `parallel`/`pipeline` renders ≥1 fan-out with ≥1 lane; 0
  self-lint errors; fixpoint holds across all 70 parseable workflows.
- `biorce-er-poc-build` (the named target) renders its Design/Build/Verify/Assemble `parallel` steps as
  visible multi-lane fan-outs, not single boxes.
- New `fanout`/`subworkflow` kinds: zod + codegen + snapshot + validation + panel + round-trip.
- All M6–M9 gallery fixtures STILL byte-identical (no regression); a new `fanout` gallery fixture
  round-trips byte-identical.
- `npm run gate` + `npm run lint` green; fixtures drift-clean; matrix parity; code-reviewer APPROVE.
