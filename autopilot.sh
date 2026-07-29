#!/usr/bin/env bash
# Run milestones unattended, one claude session per milestone (fresh context each time).
# Usage: ./autopilot.sh [max_milestones]   (default 1; use 6 for a full run)
set -euo pipefail
max="${1:-1}"
for i in $(seq 1 "$max"); do
  grep -qE '\| pending \|| in-progress \|' docs/briefs/STATE.md || { echo "All milestones done."; exit 0; }
  echo "=== Autopilot pass $i =========================================="
  claude -p "/next" --verbose --output-format text || { echo "Pass $i failed — inspect and rerun."; exit 1; }
done
echo "Autopilot finished $max pass(es). Check docs/briefs/STATE.md."
