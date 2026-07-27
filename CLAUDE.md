# Claude Flow Designer

Visual, node-based designer for Claude Code workflows. Users drag/drop and connect nodes
(triggers, prompt steps, subagents, hooks, gates), configure every real Claude Code parameter
in a property panel, and export a ready-to-use `.claude/` folder (skills, agents, hooks,
settings.json) plus an optional headless runner script. Ships as BOTH:
1. A standalone local web app (Vite + React).
2. A VS Code extension (webview hosting the same canvas, with workspace file integration).

## Monorepo layout (npm workspaces)

- `packages/core` — pure TypeScript, ZERO React/DOM deps. Workflow graph schema (zod),
  validation, and all code generation (graph → files). Everything testable headlessly.
- `packages/canvas` — shared React Flow canvas + property panels. Consumed by both hosts.
  Communicates with its host ONLY through the `HostBridge` interface (see `docs/SPEC-NODES.md`).
- `packages/web` — Vite standalone app. Implements `HostBridge` with browser APIs
  (File System Access API + zip download fallback).
- `packages/vscode` — VS Code extension. Implements `HostBridge` via webview postMessage;
  extension host does actual fs writes into the open workspace's `.claude/` folder.

## Commands

- `npm install` — install all workspaces
- `npm run build` — build all packages (core → canvas → web → vscode)
- `npm run test` — vitest, all packages (codegen snapshot tests live in `packages/core`)
- `npm run dev:web` — Vite dev server for the web app
- `npm run dev:vscode` — watch-compile extension, then F5 in VS Code to launch Extension Host
- `npm run package:vscode` — `vsce package` → `.vsix`

## Hard rules

- `packages/core` must never import from React, `vscode`, or DOM APIs. Codegen is pure
  functions: `(WorkflowGraph) => GeneratedFile[]`.
- Every codegen feature MUST match the mapping tables in `docs/SPEC-CODEGEN.md`. If official
  Claude Code behavior and this doc conflict, verify against https://code.claude.com/docs
  (hooks, skills, sub-agents, settings, model-config, cli-reference) and update the doc in
  the same PR.
- Every generated file type has a snapshot test. Adding/changing a node property without a
  codegen test is a review blocker.
- Generated hook scripts must be POSIX sh compatible, use `jq` for JSON, `exit 2` for
  blocking, and pass `shellcheck`.
- Validation is a first-class subsystem: rule catalog + export gate in
  `docs/SPEC-VALIDATION.md`, engine in `packages/core/src/validate.ts`. `generate()` MUST
  call `exportGate()` and refuse to emit on blocking diagnostics. Doc<->code parity is
  CI-enforced (validation-matrix test).
- Code review is a gate, not a suggestion: run `/review-pr` (code-reviewer subagent) before
  any commit; the Stop hook blocks finishing a turn while `npm run gate` is red; CI and the
  PR template checklist follow `docs/SPEC-REVIEW.md`. Snapshot updates require a written
  justification.
- UI: follow the design tokens in `packages/canvas/src/tokens.ts`. Dark-mode first (VS Code
  webviews inherit theme via CSS variables `--vscode-*`; web app maps the same token names).
- TypeScript strict mode. No default exports. Conventional commits: `feat/fix/chore(scope): msg`.

## Working method

Work milestone by milestone from `docs/briefs/` (M0 → M5). Each brief defines scope,
out-of-scope, and acceptance criteria — acceptance criteria are the contract; do not mark
a brief done without demonstrating each one. UI work follows `docs/DESIGN-BRIEF.md`.

## Key domain knowledge

Read `docs/REFERENCE-CLAUDE-CODE.md` before touching schema or codegen, and `docs/SPEC-VALIDATION.md` + `docs/SPEC-REVIEW.md` before touching validation or review tooling. It is the distilled
parameter reference (frontmatter fields, all hook events + handler types, settings keys,
effort levels, permission modes, CLI flags, env vars) gathered from official docs.

## Definition of done for a node type

1. Zod schema in `core/src/schema/` + added to the `WorkflowNode` union.
2. Codegen mapping implemented + snapshot test.
3. Validation rules (if any) implemented + test.
4. Property panel component in `canvas` with every field, grouped Basic/Advanced.
5. Round-trip: importer parses the generated output back into an equivalent node.
