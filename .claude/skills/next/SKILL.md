---
description: Autonomously advance the project one milestone. Reads docs/briefs/STATE.md, resumes the in-progress brief or starts the next pending one, executes it to acceptance, runs verification and review gates, then updates STATE.md and ROADMAP.md and commits. Use whenever the user says "next", "continue", or "proceed".
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(npm run *), Bash(npm test*), Bash(npx *), Bash(git *), Bash(shellcheck *)
---

## Context
- State: !`cat docs/briefs/STATE.md`
- Last commits: !`git log --oneline -8`
- Working tree: !`git status --short`

## Procedure
1. Determine target milestone: the `in-progress` one, else the first `pending`. If none,
   report "all milestones done" and stop.
2. Mark it `in-progress` in STATE.md (commit: `chore: start <id>`), if not already.
3. Execute docs/briefs/<id>-*.md item by item per its scope. Small conventional commits.
4. Demonstrate EVERY acceptance criterion; paste evidence (test output, CLI runs).
5. Run /codegen-verify, then /review-pr; loop until the code-reviewer verdict is APPROVE.
6. Update STATE.md to `done` (with one-line note) and tick the matching ROADMAP.md boxes
   in the same final commit: `chore: complete <id>`.
7. Print a completion report: what shipped, evidence links (paths), what's next.
Stop after ONE milestone. Do not begin the next without being invoked again.
