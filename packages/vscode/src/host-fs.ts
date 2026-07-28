// Pure filesystem LOGIC for the extension host, decoupled from the `vscode` API
// via small injectable primitives so it unit-tests in node. The thin vscode glue
// (VS Code fs, diff view, terminal) lives in extension.ts and calls these.
import { safePathSegments } from '@clauflow/core';
import type { GeneratedFile } from '@clauflow/core';

/** Minimal fs surface the host needs; implemented over vscode.workspace.fs. */
export interface FsAccess {
  read(relPath: string): Promise<string | null>; // null if absent
  write(relPath: string, content: string): Promise<void>;
  /** List relative file paths under a directory (recursive), or [] if absent. */
  list(relDir: string): Promise<string[]>;
}

export type FileChange =
  | { path: string; kind: 'create'; content: string }
  | { path: string; kind: 'modify'; content: string; previous: string }
  | { path: string; kind: 'unchanged'; content: string };

/**
 * Compute the per-file export plan: compare each generated file against what is
 * already on disk so the host can show a native diff/confirm and skip no-ops.
 * Refuses any unsafe path up front (shared core guard) — the workspace writer
 * must never escape ${workspaceFolder}/.claude.
 */
export async function planExport(files: GeneratedFile[], fs: FsAccess): Promise<FileChange[]> {
  for (const f of files) {
    if (safePathSegments(f.path) === null) {
      throw new Error(`refusing to export unsafe path: ${f.path}`);
    }
  }
  const plan: FileChange[] = [];
  for (const f of files) {
    const previous = await fs.read(f.path);
    if (previous === null) plan.push({ path: f.path, kind: 'create', content: f.content });
    else if (previous === f.content) plan.push({ path: f.path, kind: 'unchanged', content: f.content });
    else plan.push({ path: f.path, kind: 'modify', content: f.content, previous });
  }
  return plan;
}

/** Files in the plan that actually need writing (create/modify). */
export function changesToWrite(plan: FileChange[]): FileChange[] {
  return plan.filter((c) => c.kind !== 'unchanged');
}

// Which workspace files feed parseProject on import (same set as the web host).
const IMPORT_GLOBS = [
  /^\.claude\/skills\/[^/]+\/SKILL\.md$/,
  /^\.claude\/commands\/[^/]+\.md$/,
  /^\.claude\/agents\/[^/]+\.md$/,
  /^\.claude\/settings\.json$/,
  /^\.claude\/settings\.local\.json$/,
  /^flow\.clauflow\.json$/,
  /^run\.sh$/,
];

export function isImportable(path: string): boolean {
  return IMPORT_GLOBS.some((re) => re.test(path));
}

/** Read the importable .claude assets from the workspace into GeneratedFile[]. */
export async function collectWorkspaceAssets(fs: FsAccess): Promise<GeneratedFile[]> {
  const paths = [...(await fs.list('.claude')), ...(await fs.list('.'))]
    .filter((p, i, a) => a.indexOf(p) === i)
    .filter(isImportable);
  const files: GeneratedFile[] = [];
  for (const path of paths) {
    const content = await fs.read(path);
    if (content !== null) files.push({ path, content });
  }
  return files;
}

/**
 * Detected workspace assets for the "Claude Workflows" tree view, grouped by kind.
 * Pure over a flat path list so the TreeDataProvider stays a thin adapter.
 */
export interface DetectedAssets {
  skills: string[];
  agents: string[];
  hooks: string[];
  graphs: string[];
}

export function detectAssets(paths: string[]): DetectedAssets {
  const skills: string[] = [];
  const agents: string[] = [];
  const hooks: string[] = [];
  const graphs: string[] = [];
  for (const p of paths) {
    if (/^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(p) || /^\.claude\/commands\/[^/]+\.md$/.test(p)) skills.push(p);
    else if (/^\.claude\/agents\/[^/]+\.md$/.test(p)) agents.push(p);
    else if (/^\.claude\/hooks\/[^/]+\.sh$/.test(p)) hooks.push(p);
    else if (/\.clauflow\.json$/.test(p)) graphs.push(p);
  }
  return { skills, agents, hooks, graphs };
}

/**
 * Extract the exact `claude …` invocation from a generated run.sh, joining a
 * multi-line command into one shell line (fixes the M2 runnerCommand truncation
 * carry-over so `run` gets the full command, not just the first line).
 */
export function runnerCommand(files: GeneratedFile[]): string | null {
  const run = files.find((f) => f.path === 'run.sh');
  if (!run) return null;
  const lines = run.content.split('\n');
  const start = lines.findIndex((l) => l.startsWith('claude '));
  if (start === -1) return null;
  // Collect continuation lines (a trailing backslash or an unterminated quote).
  const parts = [lines[start]!];
  for (let i = start + 1; i < lines.length; i++) {
    const prev = parts[parts.length - 1]!;
    if (prev.endsWith('\\') || unbalancedQuote(parts.join('\n'))) parts.push(lines[i]!);
    else break;
  }
  return parts.join('\n');
}

function unbalancedQuote(s: string): boolean {
  const singles = (s.match(/'/g) ?? []).length;
  return singles % 2 === 1;
}
