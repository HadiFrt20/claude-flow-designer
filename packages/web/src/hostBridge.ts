// Web HostBridge: implements the canvas ↔ host contract with browser APIs.
// Primary path is the File System Access API (write the .claude tree into a
// user-chosen directory; import an existing project dir). When that API is
// unavailable (e.g. Firefox), export degrades to a zip download.
import type { GeneratedFile, WorkflowGraph } from '@clauflow/core';
import { parseProject } from '@clauflow/core';
import type { HostBridge, WriteResult } from '@clauflow/canvas';
import { toDirEntries, zipBlob, type DirEntry } from './export-zip.js';
import { isImportablePath, shouldDescend } from './read-project.js';

export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

interface Notifier {
  notify(level: 'info' | 'warn' | 'error', msg: string): void;
  openFile(path: string): void;
}

export class WebHostBridge implements HostBridge {
  /** Retained handle from a pick, so repeated exports reuse the same directory. */
  private dirHandle: FileSystemDirectoryHandle | null = null;

  constructor(private ui: Notifier) {}

  async writeFiles(files: GeneratedFile[], opts?: { dryRun?: boolean }): Promise<WriteResult> {
    if (opts?.dryRun) {
      return { written: files.map((f) => f.path), skipped: [], errors: [] };
    }
    // Enforce path safety ONCE, up front, for every writer. An unsafe path is a
    // hard error surfaced to the user — never silently rerouted to the zip.
    const entries = toDirEntries(files);

    if (supportsFileSystemAccess()) {
      try {
        return await this.writeToDirectory(entries, files.length);
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') {
          return { written: [], skipped: files.map((f) => f.path), errors: [] };
        }
        // A real write failure (e.g. permission) degrades to the zip — the paths
        // are already validated, so this fallback can't be an escape vector.
        this.ui.notify('warn', `Directory write failed (${(err as Error).message}); downloading a zip instead.`);
      }
    }
    await this.downloadZip(files);
    return { written: [], skipped: [], errors: [], zipped: files.map((f) => f.path) };
  }

  /** Write pre-validated entries into a user-picked directory, mkdir -p as needed. */
  private async writeToDirectory(entries: DirEntry[], total: number): Promise<WriteResult> {
    const root =
      this.dirHandle ?? (await window.showDirectoryPicker({ id: 'clauflow-export', mode: 'readwrite' }));
    this.dirHandle = root;

    const written: string[] = [];
    const errors: string[] = [];
    let anyExecutable = false;
    for (const { segments, file } of entries) {
      if (file.executable) anyExecutable = true;
      try {
        let dir = root;
        for (const seg of segments.slice(0, -1)) {
          dir = await dir.getDirectoryHandle(seg, { create: true });
        }
        const leaf = segments[segments.length - 1]!;
        const fh = await dir.getFileHandle(leaf, { create: true });
        const w = await fh.createWritable();
        await w.write(file.content);
        await w.close();
        written.push(file.path);
      } catch (err) {
        errors.push(`${file.path}: ${(err as Error).message}`);
      }
    }
    this.ui.notify(errors.length ? 'warn' : 'info', `Wrote ${written.length}/${total} files.`);
    // The File System Access API can't set the exec bit; tell the user how.
    if (anyExecutable && errors.length === 0) {
      this.ui.notify('warn', 'Mark hook scripts executable: chmod +x .claude/hooks/*.sh run.sh');
    }
    return { written, skipped: [], errors };
  }

  private async downloadZip(files: GeneratedFile[]): Promise<void> {
    const blob = await zipBlob(files);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'clauflow-export.zip';
    a.click();
    URL.revokeObjectURL(url);
    this.ui.notify('info', `Downloaded ${files.length} files as clauflow-export.zip.`);
  }

  /** Import: pick a directory, read the .claude assets, parse into a graph. */
  async readProject(): Promise<WorkflowGraph | null> {
    if (!supportsFileSystemAccess()) {
      this.ui.notify('error', 'Importing a folder needs a Chromium-based browser (File System Access API).');
      return null;
    }
    let root: FileSystemDirectoryHandle;
    try {
      root = await window.showDirectoryPicker({ id: 'clauflow-import', mode: 'read' });
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null;
      throw err;
    }
    const files = await collectImportable(root, '');
    if (files.length === 0) {
      this.ui.notify('warn', 'No .claude assets found in that folder.');
      return null;
    }
    return parseProject(files);
  }

  openFile(path: string): void {
    this.ui.openFile(path);
  }

  notify(level: 'info' | 'warn' | 'error', msg: string): void {
    this.ui.notify(level, msg);
  }
}

/** Recursively collect importable files under a directory handle. */
async function collectImportable(
  dir: FileSystemDirectoryHandle,
  prefix: string,
): Promise<GeneratedFile[]> {
  const out: GeneratedFile[] = [];
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      if (shouldDescend(path)) out.push(...(await collectImportable(handle, path)));
    } else if (isImportablePath(path)) {
      const file = await (handle as FileSystemFileHandle).getFile();
      out.push({ path, content: await file.text() });
    }
  }
  return out;
}
