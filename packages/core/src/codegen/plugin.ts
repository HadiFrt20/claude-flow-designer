// Optional plugin-bundle export target. SPEC-CODEGEN "Output layout" note.
// A plugin bundles skills/agents/hooks under a plugin.json + hooks/hooks.json.
import type { GeneratedFile } from '../schema/types.js';
import type { WorkflowGraph } from '../schema/graph.js';
import { stableJson } from './json.js';
import type { HooksBlock } from './settings.js';

// In a plugin, hook scripts live at <root>/hooks/… and are referenced via
// ${CLAUDE_PLUGIN_ROOT} (REFERENCE-CLAUDE-CODE.md — plugin env vars), NOT the
// project-scoped ${CLAUDE_PROJECT_DIR}/.claude/hooks path used in settings.json.
function rewriteCommandPaths(block: HooksBlock): HooksBlock {
  const rewritten: HooksBlock = {};
  for (const [event, entries] of Object.entries(block)) {
    rewritten[event] = entries.map((entry) => ({
      ...entry,
      hooks: entry.hooks.map((h) => {
        if (h.type !== 'command' || typeof h.command !== 'string') return h;
        const command = h.command.replace(
          /^\$\{CLAUDE_PROJECT_DIR\}\/\.claude\/hooks\//,
          '${CLAUDE_PLUGIN_ROOT}/hooks/',
        );
        return { ...h, command };
      }),
    }));
  }
  return rewritten;
}

/**
 * Re-root the standard `.claude/` output under a plugin layout and add
 * plugin.json + hooks/hooks.json. Both project- and local-scoped hooks fold into
 * hooks.json (a plugin has no settings.local.json).
 */
export function emitPluginBundle(
  graph: WorkflowGraph,
  files: GeneratedFile[],
  projectBlock: HooksBlock,
  localBlock: HooksBlock = {},
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
    // Move .claude/<x> → <root>/<x>; drop settings files (hooks go to hooks.json).
    if (f.path === '.claude/settings.json') continue;
    if (f.path === '.claude/settings.local.json') continue;
    const rel = f.path.replace(/^\.claude\//, '');
    out.push({ ...f, path: `${root}/${rel}` });
  }

  const merged: HooksBlock = { ...rewriteCommandPaths(projectBlock) };
  for (const [event, entries] of Object.entries(rewriteCommandPaths(localBlock))) {
    merged[event] = [...(merged[event] ?? []), ...entries];
  }
  if (Object.keys(merged).length) {
    out.push({ path: `${root}/hooks/hooks.json`, content: stableJson({ hooks: merged }) });
  }

  return out;
}
