#!/bin/bash
# PostToolUse (Edit|Write): fast checks on the touched file. Non-blocking; feeds context.
command -v jq >/dev/null || exit 0
input=$(cat)
file=$(jq -r '.tool_input.file_path // empty' <<<"$input")
[ -z "$file" ] && exit 0

case "$file" in
  *.sh)
    if command -v shellcheck >/dev/null; then
      res=$(shellcheck "$file" 2>&1) || {
        jq -n --arg ctx "shellcheck findings for $file:
$res" '{hookSpecificOutput:{hookEventName:"PostToolUse", additionalContext:$ctx}}'
        exit 0
      }
    fi ;;
  packages/core/src/codegen/*|packages/core/src/schema/*|packages/core/src/validate*)
    jq -n --arg ctx "Core contract file changed ($file). Before finishing: update the matching SPEC doc table, add/refresh snapshot + rule fixtures, then run /codegen-verify and /review-pr." \
      '{hookSpecificOutput:{hookEventName:"PostToolUse", additionalContext:$ctx}}'
    exit 0 ;;
esac
exit 0
