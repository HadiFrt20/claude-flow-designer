# Milestone State
<!-- Single source of truth for autonomous progression. Update ONLY via /next or
     /milestone-done. Format: one line per milestone: id | status | note -->
M0 | done | schema + 44 rules (CF001-CF504) w/ hit+miss fixtures & quick fixes, exportGate, clauflow CLI; matrix strict; code-reviewer APPROVE
M1 | done | full codegen (emitters+pipeline+self-lint), importer round-trip, 5-template gallery under fixtures/, fixtures:regen; mutation 83.8% (≥80); code-reviewer APPROVE
M2 | done | React Flow canvas + palette + per-kind property panels (every field) + settings advisor + problems/quick-fix + live preview; store w/ undo/redo/copy-paste; gallery rebuild byte-identical; code-reviewer APPROVE
M3 | done | standalone web app: WebHostBridge (FS Access dir-write + zip fallback, path-safety choke point), dir import→parseProject, IndexedDB session persist, template-gallery landing; code-reviewer APPROVE; CI green
M4 | done | VS Code extension: custom editor (canvas webview, strict CSP), postMessage HostBridge, export w/ native per-file diff-confirm, new/import/export/run commands, Claude Workflows tree view; installable .vsix; code-reviewer APPROVE; CI green (real vsce gate)
M5 | pending |
M6 | done | PIVOT: designer now targets Claude Code dynamic-workflow scripts (.claude/workflows/*.js) — 6-kind schema, workflow.ts emitter, acorn self-lint (scope-aware), CF6xx rules, sidecar round-trip, canvas + web + vscode retargeted; 288 tests, code-reviewer APPROVE; supersedes the M0–M4 asset model
M7 | done | JS→graph importer: parseWorkflowJs parses real .claude/workflows/*.js onto the canvas (typed nodes + verbatim `raw` nodes); sidecar is now derived. 5 gallery scripts round-trip byte-identical, ironclad re-generates valid; 328 tests; code-reviewer APPROVE after 4 rounds (B1 prompt-ref, B2 CF606 parity, B3/B4 raw self-lint exemption)
M8 | done | Visualization-first full workflow modeling: per-statement blocks + first-class parallel() node + opts passthrough + verbatim promptExpr (function-call prompts type as agent nodes); corpus typed coverage 5→88, 0 hard errors across 73 real workflows; 356 tests; code-reviewer APPROVE after 3 rounds (B1–B10 all fixed)
M9 | done | Structural view: phase() markers → titled group containers (parentId), agent-gating if → branch nodes w/ verbatim condExpr. Corpus: 168 phase nodes across all 70 workflows (was 0), byte-identical phase-group round-trip + fixpoint stable corpus-wide, 0 self-lint errors. CF617/618/619/620 (matrix 25); poc-phases gallery fixture; canvas renders phases as titled containers. code-reviewer APPROVE after 1 round (B1 branch-condition rule, B2 spec parity, B3 fixtures, B4 flat-phase, M1 arm-escape→raw)
<!-- statuses: pending | in-progress | done -->
