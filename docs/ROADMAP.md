# ROADMAP

## M0 — Foundation
- [x] Workspace bootstrap builds green (`npm run build`, `npm run test`).
- [x] `core`: zod schema for WorkflowGraph + all node kinds (SPEC-NODES.md).
- [x] `core`: validate.ts — ALL rules CF001–CF504 registered with hit+miss fixtures;
      validation-matrix test flipped to strict doc<->code equality.
- [x] Export gate (`exportGate`) wired and tested (errors block; warnings need ack).
- [x] Review pipeline live: /review-pr + code-reviewer subagent + Stop gate hook verified
      end-to-end on a sample change.

## M1 — Codegen (headless-complete before any UI)
- [x] SKILL.md generator (frontmatter + body composition) + snapshots.
- [x] Subagent generator + snapshots.
- [x] Hooks generator: settings.json block + generated .sh scripts (exec form, jq guard,
      decision tails) + snapshots; shellcheck in CI.
- [x] GlobalSettings → settings.json + run.sh (model/effort/permission/headless flags).
- [x] Importer round-trip: generate → parse → deep-equal graph (property test).
- [x] Self-lint stage inside generate(): parse emitted JSON/YAML, frontmatter schema check,
      shellcheck assertions (jq guard, exit-code tail matches blockability table).
- [x] Mutation testing (Stryker) on validate.ts + codegen ≥ 80% before starting M2.

## M2 — Canvas
- [x] React Flow canvas: palette, drag/drop, edges, minimap, undo/redo.
- [x] Property panels per node kind, Basic/Advanced grouping, inline validation badges.
- [x] Live preview pane: generated files update on every edit (dryRun through HostBridge).
- [x] Problems panel fed by core validation.

## M3 — Web host
- [x] Vite app, HostBridge via File System Access API + JSZip fallback.
- [x] Template gallery: PR review, smart commit, test-fix loop, security gate (PreToolUse
      deny rm -rf), session-context loader.

## M4 — VS Code extension
- [x] Webview custom editor for `*.clauflow.json`; theme via --vscode-* vars.
- [x] Commands: new / import / export (with diff-confirm) / run (terminal launch).
- [x] Tree view of existing workspace assets → click to open.
- [x] `vsce package` produces installable .vsix; smoke test in Extension Host.

## M6 — Pivot to Claude Code dynamic workflows (supersedes the M0–M4 asset model)
- [x] Schema: 6 node kinds (workflow.meta, agent, pipeline, branch, loopUntilCheck,
      output.return); resultRefs are node ids; `{{ref}}` prompt templates.
- [x] Codegen: `emitWorkflow` → `.claude/workflows/<slug>.js` (meta, ordered awaits,
      pipeline fan-out, branch if/else incl. nesting, loop while, single return) +
      `<slug>.clauflow.json` sidecar; deterministic; injection-safe interpolation.
- [x] Self-lint: real acorn parse + scope-aware identifier resolution.
- [x] Validation: CF001–008 retargeted + CF6xx; strict doc↔code matrix parity.
- [x] Templates: audit-routes, summarize, test-fix, branch-review, grade-prs; fixtures
      drift-checked.
- [x] Importer sidecar-only (one-way `.js`); canvas + web + vscode retargeted.
- [x] code-reviewer APPROVE (4 blockers + 2 majors fixed); 288 tests; lint clean.

## M5 — Sharing & polish
- [ ] Plugin-bundle export target.
- [ ] Effort×model advisor (warnings + docs links).
- [ ] Marketplace listing assets (icon, README gifs).
