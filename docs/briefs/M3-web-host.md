# Brief M3 — Web host

## Objective
Standalone local app: open/create graphs, edit, export to disk.

## In scope
- HostBridge impl: File System Access API (directory handle → write .claude tree);
  JSZip download fallback when unavailable.
- Import: pick a project directory → parseProject → canvas.
- Template gallery landing (open template → canvas).
- Persist last session graph to IndexedDB (explicit, with clear-data control).

## Carry-over from M2 review (non-blocking, address opportunistically)
- Reason-drop rule (also M1 carry-over #1): the panel now hints that
  `output.decision.reason` is dropped for PermissionRequest, but the drop is still
  silent in the gate path (Problems panel / export dialog / `clauflow validate`).
  Fast-follow: one SPEC-VALIDATION row + an `info` rule (fires only when the
  connected event resolves to PermissionRequest) + 2 matrix fixtures.
- `runnerCommand` (ExportDialog) truncates a multi-line `claude` invocation to the
  first line; make it show the exact command, or emit prompts without raw newlines.
- `onNodesChange` drops the `applyNodeChanges` result; verify in-drag smoothness
  with controlled nodes (minor UX, not test-observable).

## Acceptance
- Export a gallery template into an empty dir; run `claude` there; the skill/hooks work.
- Works in a Chromium browser offline; degraded (zip) path verified in Firefox.
