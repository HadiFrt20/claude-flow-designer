# SPEC — Code Review & Quality Gates

Two distinct review loops. Don't conflate them:

- **Loop A — reviewing THIS repo's code** (the designer itself): subagent + skills + hooks
  + CI defined below.
- **Loop B — reviewing what the tool GENERATES for users**: the export gate
  (SPEC-VALIDATION.md) + generated-asset linting (shellcheck, JSON/YAML parse, frontmatter
  schema check) that runs inside `generate()` and again in CI on gallery fixtures.

## Loop A — repo review pipeline

### Order of gates (cheapest first; a change must pass all)
1. **PostToolUse hooks (instant)** — on Edit/Write: typecheck touched package
   (`tsc --noEmit -p <pkg>`), shellcheck for `.sh`, `prettier --check`.
2. **Stop gate (per turn)** — a `Stop` hook runs `npm run -s gate` (typecheck + affected
   tests). Failure returns `decision: "block"` with the failing output, so Claude cannot
   declare a task done with a red gate. Escape hatch: `SKIP_STOP_GATE=1` env for
   exploratory sessions (documented, discouraged).
3. **/review-pr skill (pre-PR, human-invoked or auto before commit skills)** — delegates
   to the `code-reviewer` subagent (own context window, read-only tools) with the diff.
4. **CI (.github/workflows/ci.yml)** — lint, typecheck, build, full vitest,
   validation-matrix test, codegen snapshots, shellcheck on regenerated gallery
   fixtures, round-trip property test, and a real `vsce package` of the extension
   (`.vsix` must build).
5. **Human merge** — PR template checklist must be completed; CI green is necessary,
   not sufficient.

### code-reviewer subagent charter (`.claude/agents/code-reviewer.md`)
Read-only (Read, Grep, Glob, Bash(git diff *)). Reviews for, in priority order:
1. **Spec drift** — does the change match SPEC-NODES / SPEC-CODEGEN / SPEC-VALIDATION?
   Any new node property without a rule-catalog entry and codegen snapshot = blocker.
2. **Correctness of Claude Code semantics** — blockability table, matcher semantics,
   exec vs shell form, exit-code meanings. Cite REFERENCE-CLAUDE-CODE.md lines.
3. **Boundary violations** — core importing React/vscode/DOM; canvas talking to a host
   by any channel other than HostBridge.
4. Security: generated scripts injecting unsanitized user strings into shell form;
   settings emitting secrets; webview CSP.
5. Tests: every diagnostic path and emitter branch covered; snapshots reviewed not
   blindly updated (`-u` in a diff without justification = blocker).
Output: verdict (approve / request-changes) + findings by severity, each with file:line
and a concrete fix. No style nitpicks that prettier/eslint already own.

### Review checklists by change type
- **Codegen change**: snapshot diff pasted in PR; shellcheck output; round-trip test
  updated; SPEC-CODEGEN table row updated in same PR.
- **Schema change**: zod + types.ts + SPEC-NODES + importer + panel + rule catalog row(s)
  all in same PR (the DoD in CLAUDE.md), plus a migration note if `version` bumps.
- **Extension change**: manifest diff reviewed; webview CSP unchanged or justified;
  postMessage payloads typed in hostBridge.ts; smoke steps updated in /ext-package skill.
- **Validation change**: rule fixtures (hit+miss); quick-fix transform tested; docs table
  row; ackable warnings justified (why warn, not error?).

## Loop B — generated-asset review

- `generate()` pipeline stages: validate (gate) → emit → **self-lint** (parse every emitted
  JSON/YAML, frontmatter against schema, shellcheck via embedded ruleset in tests/CI,
  assert jq guard + correct exit-code tail per event) → return files. Self-lint failure is
  a bug: it throws, never silently emits.
- Export dialog shows a **review summary** to the user before writing: file tree, per-file
  diff (VS Code uses native diff view), the acked warnings, and the exact `claude` command
  the runner will execute.
- Template gallery fixtures are regenerated in CI and diffed against committed copies, so
  any codegen behavior change is visible in PR review as a fixture diff.

## Metrics of "reviewed enough"
- Mutation-testing (Stryker) budget on `core/src/validate.ts` and `codegen/`: score ≥ 80%
  before M2 starts (catching assertion-free tests).
- No PR merges with uncovered new branches in core (coverage gate: patch coverage ≥ 90%).
