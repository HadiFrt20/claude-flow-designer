# DESIGN BRIEF — Canvas & Panels

Subject: a workbench for people who automate their coding agent. Audience: developers who
live in VS Code and terminals. The page's single job: make a workflow graph legible at a
glance and every Claude Code parameter reachable in two clicks.

## Direction
The aesthetic reference is the object being produced: **the terminal and the settings
file** — monospaced accents, precise hairlines, ANSI-inspired color coding — not a generic
SaaS canvas. One deliberate risk: node headers set in the mono face with a `/command`-style
prefix glyph per category, so the canvas reads like a living config file.

## Tokens (canvas/src/tokens.ts — names, not hardcoded values in components)
- Surfaces/text: map 1:1 to `--vscode-editor-*` in the extension; web app defines the same
  custom properties on :root (dark-first, light supported).
- Category accents (the only saturated colors on the canvas):
  - trigger: amber; step: cyan; subagent: violet; hook handler: green; gate/decision: red.
  Accents appear ONLY as a 2px left node border + port dots + minimap tint. Node bodies
  stay neutral so diagnostics badges (error red / warn amber ring) always dominate.
- Type: UI text = host UI font (`--vscode-font-family`); identifiers, matchers, generated
  preview = mono (`--vscode-editor-font-family`). No third face.
- Spacing 4px grid; radius 4 (nodes), 2 (inputs); hairline borders, no shadows except a
  1-level lift on drag.

## Signature element
The **live preview pane**: generated files rendered as an authentic dark editor buffer
with subtle line-level highlight of the lines affected by the currently selected node —
the "aha" that the graph IS the file.

## Interaction rules
- Validation is ambient: badge on node, underline on field, row in Problems panel — same
  diagnostic object, three renderings. Quick fix is always a button, never a hidden menu.
- Export dialog = review moment: file tree, diffs, warning acks with rule IDs, and the
  exact `claude` command. Primary action reads "Write N files", never "OK".
- Copy: name things by what users control ("Blocks the tool call", not "returns
  permissionDecision deny" — the mono detail line can show the raw field). Errors state
  the fix ("Append __.* to match server tools"), never just the problem.
- Quality floor: keyboard navigable canvas, visible focus, reduced-motion respected,
  no color-only meaning (badges carry icons).
