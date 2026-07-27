---
description: Run the repo code-review gate on the current diff via the code-reviewer subagent, then fix blockers. Use before committing or opening a PR, and after any codegen/validation change.
allowed-tools: Read, Grep, Glob, Edit, Bash(git diff *), Bash(git status*), Bash(npm run *), Bash(npx vitest*)
---

## Context
- Status: !`git status --short`
- Diff: !`git diff HEAD`

## Task
1. Use the code-reviewer subagent to review the diff above. Provide it the change-type
   checklist from docs/SPEC-REVIEW.md that matches this change (codegen / schema /
   extension / validation).
2. Fix every blocker it reports; re-run the subagent until APPROVE.
3. Run `npm run -s gate` and confirm green.
4. Summarize: verdict, findings fixed, findings consciously deferred (with justification).
