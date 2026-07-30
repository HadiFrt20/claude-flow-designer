# Brief M8 — Model full workflow scripts in blocks (parallel + per-statement + opts)

## Objective
Import real, complex `.claude/workflows/*.js` as a graph of MANY meaningful blocks, not one opaque
raw blob. Concretely: `ironclad-basketball-stats-solution.js` (currently `meta + 1 raw`) should import
as one node per top-level statement, with `agent`/`pipeline`/`parallel` calls TYPED and the rest kept
as individual verbatim `raw` blocks.

## Evidence (corpus of 73 real authored workflows under ~/.claude/projects/**/workflows/scripts)
- **0 / 73** use only the documented subset — every real workflow uses `parallel()`, `phase()`,
  `log()`, or a `for`/`while` loop.
- **`parallel()` is the dominant concurrency primitive: 118 calls.** Shape:
  `const x = await parallel(SOURCE.map(item => () => agent(PROMPT, OPTS)))` or `parallel([...thunks])`.
- Agent opts actually used: `label`, `schema`, `model`, `phase`, `effort`, `agentType`.

## Design decision (from the user): model parallel + richer opts as first-class; keep the rest raw
The public docs (code.claude.com/docs/en/workflows) specify only `agent({schema,label})` + model,
`pipeline`, `args`, `meta{name,description}`. `parallel`/`phase`/`log`/`effort`/`agentType` are
UNDOCUMENTED runtime conveniences. We therefore ground their model in the corpus, and enforce one
safety invariant so we never drift: **the parser types a construct ONLY if codegen re-emits it
byte-identically.** We recognize syntax already in the file and mirror it back — never invent syntax.

## In scope
- **Per-statement blocks**: `parseWorkflowJs` emits ONE node per top-level statement (stop merging
  consecutive un-typed statements). ironclad → ~38 ordered blocks instead of 1.
- **`parallel` node kind** (`schema/nodes.ts`): models `parallel(SOURCE.map(v => () => agent(P,O)))`
  and `parallel([...])`. Round-trips byte-identical.
- **Agent/pipeline opts passthrough**: preserve `phase`/`effort`/`agentType` (and any other opt keys)
  verbatim via an `extraOpts` field so a template-literal agent call TYPES instead of falling to raw.
  Codegen re-emits opts in original key order.
- **Codegen + validation + panel + round-trip** for the new kind + fields (the CLAUDE.md DoD).

## Out of scope (kept as per-statement `raw` blocks — visible, verbatim, round-trip-safe)
- `for`/`while` loop bodies with arbitrary logic (judge-loops). Modeling them typed = guesswork the
  docs don't support.
- Function-call prompts (`agent(researchPrompt(d), …)`): the prompt isn't a template literal, so it
  can't map to a `prompt` string field. Stays raw.
- `phase()`/`log()` bare statements: raw (they're side-effecting runtime calls, not data nodes).

## Acceptance
- All 5 gallery scripts STILL round-trip byte-identical (no regression).
- A `parallel(...)` fixture round-trips byte-identical through the new typed node.
- ironclad imports as meta + ~N per-statement blocks (N ≫ 1), with its `parallel`/`agent` calls typed
  where prompts are template literals; `generate()` re-emits a valid, self-lint-passing workflow.
- New `parallel` kind: zod + codegen + snapshot + validation rule(s) + panel field + round-trip.
- `npm run gate` + `npm run lint` green; fixtures drift-clean; code-reviewer APPROVE.
