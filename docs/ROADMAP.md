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
- [ ] SKILL.md generator (frontmatter + body composition) + snapshots.
- [ ] Subagent generator + snapshots.
- [ ] Hooks generator: settings.json block + generated .sh scripts (exec form, jq guard,
      decision tails) + snapshots; shellcheck in CI.
- [ ] GlobalSettings → settings.json + run.sh (model/effort/permission/headless flags).
- [ ] Importer round-trip: generate → parse → deep-equal graph (property test).
- [ ] Self-lint stage inside generate(): parse emitted JSON/YAML, frontmatter schema check,
      shellcheck assertions (jq guard, exit-code tail matches blockability table).
- [ ] Mutation testing (Stryker) on validate.ts + codegen ≥ 80% before starting M2.

## M2 — Canvas
- [ ] React Flow canvas: palette, drag/drop, edges, minimap, undo/redo.
- [ ] Property panels per node kind, Basic/Advanced grouping, inline validation badges.
- [ ] Live preview pane: generated files update on every edit (dryRun through HostBridge).
- [ ] Problems panel fed by core validation.

## M3 — Web host
- [ ] Vite app, HostBridge via File System Access API + JSZip fallback.
- [ ] Template gallery: PR review, smart commit, test-fix loop, security gate (PreToolUse
      deny rm -rf), session-context loader.

## M4 — VS Code extension
- [ ] Webview custom editor for `*.clauflow.json`; theme via --vscode-* vars.
- [ ] Commands: new / import / export (with diff-confirm) / run (terminal launch).
- [ ] Tree view of existing workspace .claude assets → click to import.
- [ ] `vsce package` produces installable .vsix; smoke test in Extension Host.

## M5 — Sharing & polish
- [ ] Plugin-bundle export target.
- [ ] Effort×model advisor (warnings + docs links).
- [ ] Marketplace listing assets (icon, README gifs).
