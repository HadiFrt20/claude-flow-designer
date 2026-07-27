---
description: Verify generated .claude assets are valid — snapshot tests, shellcheck on generated hook scripts, JSON/YAML lint, round-trip import equality. Use after any codegen change.
allowed-tools: Read, Grep, Glob, Bash(npm test*), Bash(npx vitest*), Bash(shellcheck *), Bash(node *)
---

## Context
- Changed files: !`git diff --name-only HEAD`

## Task
1. Run codegen snapshot tests: `npx vitest run packages/core`.
2. Regenerate fixtures for the template gallery and run `shellcheck` on every generated
   `.sh` (must pass: jq guard present, `exit 2` only on blockable events, exec-form args
   for path placeholders).
3. Validate emitted settings.json parses and matches the GlobalSettings mapping table in
   docs/SPEC-CODEGEN.md (effort xhigh/max must NOT be in settings.json — CLI flag only).
4. Round-trip: generate → parseProject → deep-equal graph. Report any drift.
