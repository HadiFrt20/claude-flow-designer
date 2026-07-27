# Brief M3 — Web host

## Objective
Standalone local app: open/create graphs, edit, export to disk.

## In scope
- HostBridge impl: File System Access API (directory handle → write .claude tree);
  JSZip download fallback when unavailable.
- Import: pick a project directory → parseProject → canvas.
- Template gallery landing (open template → canvas).
- Persist last session graph to IndexedDB (explicit, with clear-data control).

## Acceptance
- Export a gallery template into an empty dir; run `claude` there; the skill/hooks work.
- Works in a Chromium browser offline; degraded (zip) path verified in Firefox.
