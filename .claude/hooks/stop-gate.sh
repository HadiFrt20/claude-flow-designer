#!/bin/bash
# Stop hook: block finishing the turn if the quality gate fails on a dirty tree.
command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }
input=$(cat)

[ "${SKIP_STOP_GATE:-0}" = "1" ] && exit 0
# Only gate when there are uncommitted changes to source files.
git diff --quiet HEAD -- 'packages/**' 2>/dev/null && exit 0

out=$(npm run -s gate 2>&1)
if [ $? -ne 0 ]; then
  jq -n --arg reason "Quality gate failed:
$out" '{decision:"block", reason:$reason}'
  exit 0
fi
exit 0
