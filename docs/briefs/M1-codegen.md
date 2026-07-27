# Brief M1 — Codegen (headless-complete)

## Objective
`generate(graph)` produces the full `.claude/` output per SPEC-CODEGEN.md, gated,
self-linted, and round-trippable — provable entirely from tests, no UI.

## In scope
- Emitters: SKILL.md (frontmatter + body composition rules), agents/<name>.md,
  hooks blocks per settings scope, generated hook .sh scripts (jq guard, exec form,
  decision tails per blockability table), settings.json/.local.json, run.sh, plugin bundle.
- `generate()` pipeline order: validateGraph → exportGate → emit → self-lint → files.
  Self-lint throws on any invalid emitted artifact (never silently ship).
- Importer `parseProject()` incl. legacy `.claude/commands/*.md`; unknown frontmatter
  preserved via data.extra.
- Round-trip property test: generate → parse → deep-equal (modulo layout positions).
- Template gallery fixtures: pr-review, smart-commit, test-fix-loop, security-gate,
  session-context-loader. Committed under fixtures/ and regenerated in CI (drift = fail).
- `fixtures:regen` npm script (CI already calls it).

## Acceptance
- Snapshot suite covers every frontmatter field, every hook handler type, every decision
  mode, every GlobalSettings row (incl. effort xhigh/max → run.sh only + comment).
- shellcheck clean on all generated .sh in fixtures.
- Stryker mutation score ≥ 80% on validate.ts + codegen/ (M2 entry criterion).
