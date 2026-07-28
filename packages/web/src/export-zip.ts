// Pure export helpers (no DOM). Turn GeneratedFile[] into a zip Blob and compute
// the flat write plan a directory writer will apply. Kept side-effect-free so it
// unit-tests in node; the browser glue (download / FS Access) lives in hostBridge.ts.
import JSZip from 'jszip';
import type { GeneratedFile } from '@clauflow/core';

export interface DirEntry {
  /** Path segments from the target directory root, e.g. [".claude","skills","x","SKILL.md"]. */
  segments: string[];
  file: GeneratedFile;
}

/**
 * THE single path-safety choke point for every writer (zip AND directory). Split
 * each file path into directory segments so a writer can mkdir -p then write the
 * leaf, refusing anything that could escape the chosen directory: absolute paths,
 * `.`/`..` segments, empty segments (`a//b`), or Windows-style backslashes (which
 * some extractors treat as separators). Both buildZip and the FS Access writer
 * route through this, so neither can be tricked by a hostile node name.
 */
export function toDirEntries(files: GeneratedFile[]): DirEntry[] {
  return files.map((file) => {
    const path = file.path;
    const segments = path.split('/');
    const unsafe =
      path.startsWith('/') ||
      path.includes('\\') ||
      segments.some((s) => s === '' || s === '.' || s === '..');
    if (unsafe) throw new Error(`unsafe generated path refused: ${path}`);
    return { segments, file };
  });
}

/**
 * Build a JSZip archive. Routes every path through toDirEntries first (so an
 * unsafe path throws before any archive is produced) and preserves the executable
 * bit via unix permissions.
 */
export function buildZip(files: GeneratedFile[]): JSZip {
  const zip = new JSZip();
  for (const { segments, file } of toDirEntries(files)) {
    zip.file(segments.join('/'), file.content, file.executable ? { unixPermissions: 0o755 } : undefined);
  }
  return zip;
}

// platform:'UNIX' makes generateAsync write the unix external-attributes field so
// the 0o755 exec bit survives extraction (the DOS default drops it).
const ZIP_OPTS = { platform: 'UNIX' } as const;

/** Generate the zip as a Blob (browser) — async because JSZip compresses. */
export function zipBlob(files: GeneratedFile[]): Promise<Blob> {
  return buildZip(files).generateAsync({ type: 'blob', ...ZIP_OPTS });
}

/** Generate the zip as bytes (tests). */
export function zipBuffer(files: GeneratedFile[]): Promise<Uint8Array> {
  return buildZip(files).generateAsync({ type: 'uint8array', ...ZIP_OPTS });
}
