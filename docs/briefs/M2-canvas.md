# Brief M2 — Canvas

## Objective
The shared React Flow editor: everything a user needs to express any graph the schema
allows, with live validation and live preview. Host-agnostic (HostBridge only).

## In scope
- Palette grouped Triggers / Steps / Hooks / Control; drag-drop; edge rules enforce
  SPEC-NODES compatibility (invalid connection = CF005 preview, not silent allow).
- Property panel per node kind: EVERY field, Basic/Advanced grouping; matcher and
  permission-rule inputs get syntax help + validation as-you-type.
- GlobalSettings panel incl. model×effort advisor (CF401/CF402 surfaced inline).
- Problems panel bound to validateGraph; quick-fix buttons apply core transforms.
- Live preview pane: dryRun generate on debounce; per-file tabs; blocked state shows the
  gate's blocking diagnostics instead of stale output.
- Undo/redo, copy/paste, minimap, keyboard a11y for node selection.
- Visual design per docs/DESIGN-BRIEF.md; tokens in canvas/src/tokens.ts mapped to
  --vscode-* variables with web fallbacks.

## Out of scope
File writing (hosts), import UI flows.

## Acceptance
- Storybook (or equivalent) story per node panel; interaction tests for quick-fix apply.
- Rebuilding each gallery template by hand on the canvas yields byte-identical export
  to the M1 fixture.
