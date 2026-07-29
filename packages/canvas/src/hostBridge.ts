import type { GeneratedFile, WorkflowGraph } from '@clauflow/core';

export interface WriteResult {
  written: string[];
  skipped: string[];
  errors: string[];
  /** Files delivered via the zip-download fallback (no direct dir write). */
  zipped?: string[];
}

export interface HostBridge {
  writeFiles(files: GeneratedFile[], opts?: { dryRun?: boolean }): Promise<WriteResult>;
  /** Import an existing project into a graph (null = cancelled / nothing found). */
  readProject(): Promise<WorkflowGraph | null>;
  openFile(path: string): void;
  pickDirectory?(): Promise<string | null>;
  notify(level: 'info' | 'warn' | 'error', msg: string): void;
}
