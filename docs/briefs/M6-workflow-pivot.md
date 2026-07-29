# Brief M6 — Pivot to dynamic-workflow scripts

## Objective
Retarget the designer from `.claude/` *assets* to Claude Code **dynamic workflows** — JavaScript
orchestration scripts at `.claude/workflows/<slug>.js` (see docs/REFERENCE-CLAUDE-CODE.md → "Dynamic
workflows"). The graph now models a workflow (agents fanned out via `agent()` / `pipeline()`), and
`generate()` emits the `.js` script + a round-trip sidecar.

## Why
The M0–M4 build designed `.claude/` skills/subagents/hooks/settings and called that a "workflow",
colliding with Claude Code's real `/workflows` feature. This pivot makes the tool design the actual
thing. M0–M4 code stays in git history (PR #1) but is superseded.

## In scope
- **Schema** (schema/nodes.ts): 6 node kinds — `workflow.meta`, `agent`, `pipeline`, `branch`,
  `loopUntilCheck`, `output.return`. Result refs are node ids; prompts use `{{ref}}` templates.
- **Edges** (schema/edges.ts): DAG semantics + `edgeAllowed`; deterministic topo `linearize` helper.
- **Codegen** (codegen/workflow.ts): emit `.claude/workflows/<slug>.js` (meta block, ordered awaits,
  pipeline/branch/while, single return) + `<slug>.clauflow.json` sidecar; deterministic output.
- **Self-lint**: real `acorn` parse of the emitted `.js` + meta/return/identifier checks.
- **Validation** (rules/workflow.ts): CF6xx (601–615); retarget CF001–008; drop CF1xx–5xx.
- **Templates** (templates.ts): audit-routes (fan-out+merge), test-fix (loop), branch-review,
  single-agent, args-pipeline. Committed under fixtures/, drift-checked.
- **Importer**: sidecar-only round-trip; `.js` is one-way.
- **Canvas** (fields.ts, tokens.ts): descriptors/palette/categories for the 6 kinds.
- **VS Code**: tree view + import retarget to `.claude/workflows/`.

## Out of scope
- Parsing `.js` → graph (one-way output; sidecar is the round-trip source of truth).
- Arbitrary JS (only the structured subset: single agent, fan-out, review/merge, loop, branch).
- Plugin-bundle export target (dormant).

## Acceptance
- `generate()` emits an acorn-parseable `.js` for every gallery template; snapshots committed and
  drift-checked by `fixtures:regen` in CI.
- Round-trip: `parseProject(generate(t.graph))` deep-equals each template graph via the sidecar.
- Every CF6xx rule + retargeted CF0xx has hit+miss fixtures; `validation-matrix.test.ts` strict
  doc↔code parity green.
- `npm run gate` + `npm run lint` green; CI green.
- code-reviewer APPROVE on the diff (SPEC-REVIEW Loop A) + `/codegen-verify` (Loop B).
- Manual: export a template's `.js` into a repo's `.claude/workflows/`, invoke `/<name>` in Claude
  Code, confirm it orchestrates.
