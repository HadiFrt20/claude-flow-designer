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
M7 | in-progress | JS→graph importer: parse real .claude/workflows/*.js onto the canvas (best-effort typed nodes + opaque raw nodes); sidecar becomes derived
<!-- statuses: pending | in-progress | done -->
