# Brief M7 — JS → graph importer (real workflows on the canvas)

## Objective
Make `import` mean "parse a real `.claude/workflows/<name>.js` into an editable graph." Until now
the round-trip source of truth was the `<slug>.clauflow.json` sidecar — but **real workflows are
authored as `.js` by Claude Code sessions and never have a sidecar**. A designer that can only edit
what it generated itself is circular. M7 adds `parseWorkflowJs(source): WorkflowGraph` so any emitted
(or simple hand-authored) workflow opens on the canvas, and complex ones degrade gracefully.

## Why
Live-testing surfaced that the tool couldn't open the user's own dozens of authored workflows
(`~/.claude/projects/**/workflows/scripts/*.js`) — they opened as read-only text. The sidecar is a
derived projection, not a user artifact.

## Design decision (from the user)
Import is **best-effort + opaque raw nodes**: statements matching the structured subset become typed
nodes; everything else (schema consts, arrow helpers, `for` loops, `Promise.all`, ad-hoc expressions)
is preserved verbatim in `raw` nodes that carry their declared bindings forward, so downstream typed
nodes still resolve. Round-trip bar: `parse(x.js)` → graph → `generate()` is **byte-identical** to
`x.js` for anything within reach, and re-emits raw regions verbatim.

## In scope
- **Schema**: new `raw` node kind — `{ code: string, produces?: string[] }` (verbatim top-level
  statement group + the binding names it introduces). Added to the union + NODE_KINDS.
- **Parser** (`core/src/import-js.ts`): acorn-parse top-level statements in source order. Recognize
  `export const meta`, `const x = await agent(...)`, `const x = await pipeline(items, item => agent(...))`,
  the emitted `while` loop shape (→ loopUntilCheck when it matches; else raw), `if/else` on a result
  (→ branch when both arms are simple; else raw), `return`. Anything else → a `raw` node. Chain nodes
  by execution order (edges follow source order); preserve ids stably.
- **Codegen**: `emitStatement` emits `raw.code` verbatim at its topo position. Snapshot test.
- **Validation**: `raw.produces` bindings count as declared for CF605 ref resolution; self-lint already
  parses real JS so scope holds. A warn (CFxxx) noting a graph contains raw (non-visual) regions.
- **Importer**: `parseProject` prefers a sidecar if present, else `parseWorkflowJs` the emitted `.js`.
- **Canvas**: a `code` field type (monospace textarea) for the raw node; palette entry; a distinct
  category/accent so raw regions read as "verbatim code."
- **Hosts**: the workflow picker opens a `.js` on the **canvas** (via the parser); falls back to
  read-only text only when the parser returns unparseable.

## Out of scope
- Semantic understanding of raw regions (they're opaque verbatim text).
- Rewriting/refactoring raw JS. Editing a raw node edits its text; we re-emit as-is.
- Non-workflow `.js` (no `export const meta`) — treated as not a workflow.

## Acceptance
- `parseWorkflowJs` on all 5 gallery `.js` → graph that `generate()`s **byte-identical** to the input
  (the parser is the exact inverse of the emitter for its own output). Note byte-identity comes from
  raw-preservation too: constructs the parser doesn't type (while/if/else) round-trip as verbatim raw.
- `parseWorkflowJs` on a real complex workflow (fixture from `ironclad-basketball-...js`) → a graph
  mixing typed agent nodes + raw nodes that `generate()`s a VALID, self-lint-passing workflow (NOT
  necessarily byte-identical — a hand-authored meta with extra keys / helper-call prompts is
  canonicalized). The bar for hand-authored input is "opens on the canvas + re-exports valid".
- Opening a `.js` with no sidecar in VS Code renders it on the canvas (typed + raw nodes), not as text.
- New `raw` kind has: zod schema, codegen + snapshot, validation rule + hit/miss fixtures, panel field,
  round-trip — the CLAUDE.md DoD.
- `npm run gate` + `npm run lint` green; CI green.
- code-reviewer APPROVE (SPEC-REVIEW Loop A) + `/codegen-verify` (Loop B).
