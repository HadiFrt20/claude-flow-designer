// Pure helpers for importing an existing project directory. The recursive walk
// of a FileSystemDirectoryHandle lives in hostBridge.ts (needs the browser API),
// but WHICH files matter for parseProject is a pure decision, tested here.
//
// M6: the emitted .js is one-way output; the <slug>.clauflow.json sidecar is the
// single round-trip source of truth, so it is the only importable file.
const CLAUDE_GLOBS = [
  /(^|\/)[^/]+\.clauflow\.json$/,
];

/** Is this project-relative path one parseProject cares about? */
export function isImportablePath(path: string): boolean {
  return CLAUDE_GLOBS.some((re) => re.test(path));
}

/**
 * Directories worth descending into when importing (skip node_modules/.git/etc.
 * so a huge repo import stays fast). Sidecars live at the root or under .claude.
 */
export function shouldDescend(dirPath: string): boolean {
  if (dirPath === '') return true; // project root
  if (dirPath === '.claude') return true;
  if (dirPath.startsWith('.claude/')) return true;
  return false;
}
