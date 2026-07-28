// Pure export helpers (no DOM). Turn GeneratedFile[] into a zip Blob and compute
// the flat write plan a directory writer will apply. Kept side-effect-free so it
// unit-tests in node; the browser glue (download / FS Access) lives in hostBridge.ts.
import JSZip from 'jszip';
import type { GeneratedFile } from '@clauflow/core';

/** Build a JSZip archive of the generated files, preserving their relative paths. */
export function buildZip(files: GeneratedFile[]): JSZip {
  const zip = new JSZip();
  for (const f of files) {
    // JSZip creates intermediate folders from the path automatically. Preserve
    // the executable bit for hook scripts / run.sh via unix permissions.
    zip.file(f.path, f.content, f.executable ? { unixPermissions: 0o755 } : undefined);
  }
  return zip;
}

/** Generate the zip as a Blob (browser) — async because JSZip compresses. */
export function zipBlob(files: GeneratedFile[]): Promise<Blob> {
  return buildZip(files).generateAsync({ type: 'blob' });
}

/** Generate the zip as a Node Buffer (tests). */
export function zipBuffer(files: GeneratedFile[]): Promise<Uint8Array> {
  return buildZip(files).generateAsync({ type: 'uint8array' });
}

export interface DirEntry {
  /** Path segments from the target directory root, e.g. [".claude","skills","x","SKILL.md"]. */
  segments: string[];
  file: GeneratedFile;
}

/**
 * Split a GeneratedFile[] into directory-write entries: each file's path becomes
 * a segment list so a File System Access writer can mkdir -p then write the leaf.
 * Rejects unsafe paths (absolute, or containing `..`) so a graph can never write
 * outside the chosen directory.
 */
export function toDirEntries(files: GeneratedFile[]): DirEntry[] {
  return files.map((file) => {
    const segments = file.path.split('/').filter((s) => s.length > 0);
    if (file.path.startsWith('/') || segments.some((s) => s === '..' || s === '.')) {
      throw new Error(`unsafe generated path refused: ${file.path}`);
    }
    return { segments, file };
  });
}
