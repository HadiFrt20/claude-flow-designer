// Shared path-safety for generated file paths. A GeneratedFile.path must be a
// relative, forward-slash path that stays inside the target directory — no host
// (web dir-write, zip, VS Code workspace write) may emit a path that escapes it.
// generate()'s self-lint enforces this, so containment lives in core and every
// host inherits it rather than reimplementing the check.

/** Split a safe path into non-empty segments, or return null if it is unsafe. */
export function safePathSegments(path: string): string[] | null {
  if (path === '' || path.startsWith('/') || path.includes('\\')) return null;
  const segments = path.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null;
  return segments;
}

/** True when a generated path is safe to write relative to a target directory. */
export function isSafePath(path: string): boolean {
  return safePathSegments(path) !== null;
}
