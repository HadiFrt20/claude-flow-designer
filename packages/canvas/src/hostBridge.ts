import type { GeneratedFile } from '@clauflow/core';

export interface WriteResult { written: string[]; skipped: string[]; errors: string[] }

export interface HostBridge {
  writeFiles(files: GeneratedFile[], opts?: { dryRun?: boolean }): Promise<WriteResult>;
  readProject(): Promise<unknown | null>;
  openFile(path: string): void;
  pickDirectory?(): Promise<string | null>;
  notify(level: 'info' | 'warn' | 'error', msg: string): void;
}
