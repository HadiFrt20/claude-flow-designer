# Brief M0 — Foundation

## Objective
Compile-green monorepo with the full schema and a complete, tested validation engine.
No UI, no codegen output yet.

## In scope
- Per-package tsconfigs extending tsconfig.base.json; `npm run build|test|gate` all green.
- Zod schemas for every node kind and GlobalSettings exactly as tabled in SPEC-NODES.md;
  `WorkflowGraph` parse/serialize helpers; graph `version: 1`.
- All rules CF001–CF504 from SPEC-VALIDATION.md registered in validate.ts, each with
  hit + miss fixture graphs; quick-fix transforms implemented where the catalog names one.
- Flip validation-matrix.test.ts to strict doc<->code equality.
- `exportGate()` unit-tested: errors block; warnings block unless acked.
- Tiny CLI `packages/core/src/cli.ts`: `validate <file.clauflow.json>` → exit 1 on blockers.

## Out of scope
Codegen emitters, importer, canvas, hosts.

## Acceptance
- CI workflow passes end-to-end on a fresh clone.
- `npx clauflow validate` (or node dist/cli.js) correctly fails a fixture graph containing
  CF101 and passes it after applying the quick fix.
- code-reviewer subagent APPROVE on the final diff (/review-pr transcript in PR).
