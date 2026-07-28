# Claude Flow Designer — VS Code extension

Design Claude Code workflows on a visual canvas inside VS Code, then export a
ready-to-use `.claude/` folder into the open workspace.

## Features

- **Custom editor** for `*.clauflow.json` — opens the node canvas (triggers,
  prompt steps, subagents, hooks, gates) with a live preview of the generated
  files.
- **Export to `.claude/`** with a per-file diff/confirm before writing to the
  workspace.
- **Import** an existing `.claude/` folder back into a graph.
- **Run** — opens a terminal with the generated `claude` invocation.
- **Claude Workflows** tree view listing detected skills, subagents, hooks, and
  saved graphs; click to import.

## Commands

- `Claude Flow: New Workflow`
- `Claude Flow: Import from .claude/`
- `Claude Flow: Export to .claude/`
- `Claude Flow: Run Workflow (terminal)`

The canvas, schema, validation, and code generation are shared with the
standalone web app via the `@clauflow/core` and `@clauflow/canvas` packages.
