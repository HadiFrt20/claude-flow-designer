#!/bin/bash
# SessionStart: tell each new session where the project stands and what to do next.
command -v jq >/dev/null || exit 0
state_file="docs/briefs/STATE.md"
[ -f "$state_file" ] || exit 0

current=$(grep -E '\| in-progress \|' "$state_file" | head -1 | cut -d'|' -f1 | tr -d ' ')
next=$(grep -E '\| pending \|' "$state_file" | head -1 | cut -d'|' -f1 | tr -d ' ')
dirty=$(git status --porcelain 2>/dev/null | head -5)

ctx="PROJECT STATE (docs/briefs/STATE.md):
$(cat "$state_file" | grep -E '^M[0-9]')

STANDING ORDERS:
- If a milestone is in-progress ($current${current:+ — resume it}): continue executing docs/briefs/${current:-<none>}-*.md where it left off (check git log + todos).
- Else the next milestone is ${next:-NONE (all done)}: when asked to proceed (or via /next), execute docs/briefs/${next}-*.md.
- Acceptance criteria are the contract. Run /codegen-verify and /review-pr before marking a milestone done; update STATE.md status and ROADMAP checkboxes in the same commit.
${dirty:+
UNCOMMITTED CHANGES PRESENT:
$dirty}"

jq -n --arg ctx "$ctx" '{hookSpecificOutput:{hookEventName:"SessionStart", additionalContext:$ctx}}'
exit 0
