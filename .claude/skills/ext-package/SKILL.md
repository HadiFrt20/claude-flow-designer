---
description: Build, package, and smoke-test the VS Code extension (.vsix). Use before tagging a release or when extension packaging breaks.
allowed-tools: Read, Grep, Glob, Edit, Bash(npm run *), Bash(npx vsce *), Bash(code *)
---

1. `npm run build` at the root; fix compile errors.
2. `npm run package:vscode` — resolve vsce complaints (missing repository field, icon,
   activation events, README).
3. Verify the .vsix contains dist/extension.js and the bundled webview assets.
4. List manual smoke steps for the user: install .vsix, open a folder with a .claude dir,
   run "Claude Flow: Import", confirm tree view shows assets, export with diff view.
