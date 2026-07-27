# Brief M4 — VS Code extension

## Objective
Same canvas inside VS Code, wired to the open workspace.

## In scope
- Custom editor for *.clauflow.json (webview); strict CSP; state survives tab hide.
- HostBridge over postMessage; extension host performs fs ops; export shows native
  diff-confirm per file before writing to ${workspaceFolder}/.claude.
- Commands new/import/export/run; run opens a terminal with the generated claude
  invocation from run.sh mapping.
- Tree view "Claude Workflows" listing detected skills/agents/hooks; click → import.
- Theme via --vscode-* tokens; verify light, dark, high-contrast.

## Acceptance
- `npm run package:vscode` yields an installable .vsix; smoke steps in
  .claude/skills/ext-package/SKILL.md pass manually.
- Editing a graph, exporting, and invoking the generated slash command inside Claude Code
  in the same workspace works end-to-end.
