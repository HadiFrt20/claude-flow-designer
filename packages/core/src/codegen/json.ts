// Deterministic JSON emitter: recursively sorts object keys so settings.json and
// plugin manifests snapshot cleanly and diff minimally in the VS Code export view.
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Stable JSON with 2-space indent and a trailing newline. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2) + '\n';
}
