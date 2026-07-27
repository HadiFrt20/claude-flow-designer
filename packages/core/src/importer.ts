// parseProject(files) → WorkflowGraph. The round-trip counterpart of generate():
// read SKILL.md / legacy commands / agents / settings hooks / run.sh and
// reconstruct an equivalent graph. Unknown frontmatter keys are preserved in
// data.extra and re-emitted verbatim (SPEC-CODEGEN "Importer").
//
// Round-trip contract: parseProject(generate(g)) deep-equals g modulo node
// positions (layout is a UI concern, not semantic). The canonical path for a
// saved graph is the emitted flow.clauflow.json; when present we trust it as the
// source of truth and validate the derived assets against it.
import matter from 'gray-matter';
import type { GeneratedFile } from './schema/types.js';
import type { WorkflowGraph } from './schema/graph.js';
import type { WorkflowNode, SlashCommandData, SubagentStepData } from './schema/nodes.js';
import { parseGraphJson } from './schema/graph.js';

export interface ParsedProject {
  graph: WorkflowGraph | null;
  /** True when the graph came from an embedded flow.clauflow.json. */
  fromGraphFile: boolean;
}

/**
 * Parse a set of project files into a WorkflowGraph. If a flow.clauflow.json is
 * present it is authoritative (exact round-trip). Otherwise we reconstruct from
 * the emitted assets (best-effort; used for importing hand-authored .claude dirs).
 */
export function parseProject(files: GeneratedFile[]): WorkflowGraph | null {
  const byPath = new Map(files.map((f) => [f.path, f]));

  // Fast path: the round-trip source of truth.
  const graphFile = byPath.get('flow.clauflow.json');
  if (graphFile) {
    return parseGraphJson(graphFile.content);
  }

  return reconstruct(files);
}

/** Reconstruct a graph from emitted/hand-authored assets (no flow.clauflow.json). */
function reconstruct(files: GeneratedFile[]): WorkflowGraph | null {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowGraph['edges'] = [];
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${++counter}`;
  const pos = { x: 0, y: 0 };

  const skills = files.filter(
    (f) => /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(f.path) || /^\.claude\/commands\/[^/]+\.md$/.test(f.path),
  );
  const agents = files.filter((f) => /^\.claude\/agents\/[^/]+\.md$/.test(f.path));

  for (const f of skills) {
    const { data, content } = matter(f.content);
    const known = new Set([
      'description', 'allowed-tools', 'argument-hint', 'model', 'context', 'agent', 'disable-model-invocation', 'hooks',
    ]);
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) if (!known.has(k)) extra[k] = v;

    const nameFromPath = f.path.replace(/^\.claude\/(skills\/([^/]+)\/SKILL|commands\/([^/]+))\.md$/, '$2$3');
    const cmdId = nextId('cmd');
    const cmdData: SlashCommandData = {
      name: nameFromPath,
      description: typeof data.description === 'string' ? data.description : '',
      ...(typeof data['argument-hint'] === 'string' ? { argumentHint: data['argument-hint'] } : {}),
      ...(typeof data.model === 'string' ? { model: data.model } : {}),
      ...(data.context === 'fork' ? { contextFork: true } : {}),
      ...(typeof data.agent === 'string' ? { agent: data.agent } : {}),
      ...(data['disable-model-invocation'] === true ? { disableModelInvocation: true } : {}),
      ...(Object.keys(extra).length ? { extra } : {}),
    };
    nodes.push({ id: cmdId, kind: 'trigger.slashCommand', label: nameFromPath, position: pos, data: cmdData });

    const body = content.trim();
    if (body) {
      const stepId = nextId('step');
      nodes.push({
        id: stepId,
        kind: 'step.prompt',
        label: 'body',
        position: pos,
        data: { body },
      });
      edges.push({ id: `${cmdId}->${stepId}`, source: cmdId, target: stepId });
    }
  }

  for (const f of agents) {
    const { data, content } = matter(f.content);
    const nameFromPath = f.path.replace(/^\.claude\/agents\/([^/]+)\.md$/, '$1');
    const agentName = typeof data.name === 'string' ? data.name : nameFromPath;
    const agentData: SubagentStepData = {
      name: agentName,
      ...(typeof data.description === 'string' ? { description: data.description } : {}),
      ...(typeof data.tools === 'string'
        ? { tools: data.tools.split(',').map((t: string) => t.trim()).filter(Boolean) }
        : {}),
      ...(typeof data.model === 'string' ? { model: data.model } : {}),
      systemPrompt: content.trim(),
    };
    nodes.push({ id: nextId('agent'), kind: 'step.subagent', label: agentName, position: pos, data: agentData });
  }

  if (nodes.length === 0) return null;

  return {
    version: 1,
    meta: { name: 'Imported workflow', slug: 'imported' },
    settings: {},
    nodes,
    edges,
  };
}
