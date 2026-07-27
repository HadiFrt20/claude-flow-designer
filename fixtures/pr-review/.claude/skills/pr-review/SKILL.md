---
description: Review the staged/committed diff and report issues by severity.
allowed-tools: Bash(git *)
argument-hint: "[base-branch]"
---

## Context
- !`git diff $1...HEAD`

Review the diff above against $1. List findings grouped by severity (blocker/major/minor), each with file:line and a concrete fix.
