// Pure helpers for importing an existing project directory. The recursive walk
// of a FileSystemDirectoryHandle lives in hostBridge.ts (needs the browser API),
// but WHICH files matter for parseProject is a pure decision, tested here.
const CLAUDE_GLOBS = [
  /^\.claude\/skills\/[^/]+\/SKILL\.md$/,
  /^\.claude\/commands\/[^/]+\.md$/,
  /^\.claude\/agents\/[^/]+\.md$/,
  /^\.claude\/settings\.json$/,
  /^\.claude\/settings\.local\.json$/,
  /^flow\.clauflow\.json$/,
  /^run\.sh$/,
];

/** Is this project-relative path one parseProject cares about? */
export function isImportablePath(path: string): boolean {
  return CLAUDE_GLOBS.some((re) => re.test(path));
}

/**
 * Directories worth descending into when importing (skip node_modules/.git/etc.
 * so a huge repo import stays fast). Only `.claude` and the root matter.
 */
export function shouldDescend(dirPath: string): boolean {
  if (dirPath === '') return true; // project root
  if (dirPath === '.claude') return true;
  if (dirPath.startsWith('.claude/')) return true;
  return false;
}
