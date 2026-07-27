// Deterministic YAML frontmatter emitter. Top-level keys are emitted in a fixed,
// spec-defined order (description first, per SPEC-CODEGEN) for readable output;
// nested complex values go through js-yaml with sorted keys for stable snapshots.
import yaml from 'js-yaml';

export type FrontmatterValue = string | number | boolean | string[] | Record<string, unknown>;

function dumpNested(value: Record<string, unknown> | unknown[]): string {
  return yaml
    .dump(value, { sortKeys: true, lineWidth: -1, noRefs: true, quotingType: '"' })
    .replace(/\n$/, '');
}

function emitScalar(value: string | number | boolean): string {
  if (typeof value !== 'string') return String(value);
  // Quote strings that YAML would otherwise mis-parse (leading special chars,
  // colons+space, comment markers, wildcards, etc.). Conservative but stable.
  if (value === '') return '""';
  if (/^[A-Za-z0-9_./-][^:#]*$/.test(value) && !/[:#]\s/.test(value) && !/^[!&*?|>%@`]/.test(value)) {
    return value;
  }
  return JSON.stringify(value); // JSON string is valid YAML double-quoted scalar
}

/**
 * Emit a frontmatter block for the given ordered entries. Entries whose value is
 * undefined/null or an empty array/object are omitted ("omit empty" per SPEC).
 */
export function frontmatter(entries: Array<[string, FrontmatterValue | undefined | null]>): string {
  const lines: string[] = ['---'];
  for (const [key, value] of entries) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      // Inline comma list for simple string arrays (allowed-tools, tools).
      lines.push(`${key}: ${value.join(', ')}`);
    } else if (typeof value === 'object') {
      if (Object.keys(value).length === 0) continue;
      const dumped = dumpNested(value);
      lines.push(`${key}:`);
      for (const l of dumped.split('\n')) lines.push(`  ${l}`);
    } else {
      lines.push(`${key}: ${emitScalar(value)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}
