// Optional plugin-bundle export target. SPEC-CODEGEN "Output layout" note.
// A plugin bundles skills/agents/hooks under a plugin.json + hooks/hooks.json.
import type { GeneratedFile } from '../schema/types.js';
import type { WorkflowGraph } from '../schema/graph.js';
import { stableJson } from './json.js';

/**
 * Re-root the standard `.claude/` output under a plugin layout and add
 * plugin.json + hooks/hooks.json. `hooksBlock` is the same block emitted into
 * settings.json.
 */
export function emitPluginBundle(
  graph: WorkflowGraph,
  files: GeneratedFile[],
  hooksBlock: Record<string, unknown>,
): GeneratedFile[] {
  const root = graph.meta.slug;
  const out: GeneratedFile[] = [];

  out.push({
    path: `${root}/plugin.json`,
    content: stableJson({
      name: graph.meta.slug,
      version: '0.1.0',
      description: graph.meta.description ?? graph.meta.name,
    }),
  });

  for (const f of files) {
    // Move .claude/<x> → <root>/<x>; drop settings.json (hooks go to hooks.json).
    if (f.path === '.claude/settings.json') continue;
    if (f.path === '.claude/settings.local.json') continue;
    const rel = f.path.replace(/^\.claude\//, '');
    out.push({ ...f, path: `${root}/${rel}` });
  }

  if (Object.keys(hooksBlock).length) {
    out.push({ path: `${root}/hooks/hooks.json`, content: stableJson({ hooks: hooksBlock }) });
  }

  return out;
}
