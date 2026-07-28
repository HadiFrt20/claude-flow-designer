---
description: Build, package, and smoke-test the VS Code extension (.vsix). Use before tagging a release or when extension packaging breaks.
allowed-tools: Read, Grep, Glob, Edit, Bash(npm run *), Bash(npx vsce *), Bash(code *)
---

1. `npm run build` at the root; fix compile errors.
2. `npm run package:vscode` — resolve vsce complaints (repository field, README,
   activation events, .vscodeignore).
3. Verify the .vsix contains dist/extension.js + dist/webview.js + dist/webview.css
   (and nothing else under dist — no sourcemaps or tsc output).
4. Manual smoke steps for the user (install the .vsix, open a folder, then):
   - `Claude Flow: New Workflow` → a `*.clauflow.json` opens in the canvas editor.
   - Add nodes / edit a property; edits persist to the file and undo/redo + the
     current selection survive (no full reload on each edit).
   - `Claude Flow: Export to .claude/` → confirm modal lists the files; for modified
     files "Show diff" opens VS Code's native diff (current ⇢ proposed); "Write"
     writes into `${workspaceFolder}/.claude`.
   - `Claude Flow: Run Workflow (terminal)` → a terminal opens with the `claude`
     invocation (not auto-executed).
   - The "Claude Workflows" tree view lists detected skills/subagents/hooks/graphs;
     clicking a graph imports it.
   - Hide/show the editor tab: state survives (retainContextWhenHidden).
