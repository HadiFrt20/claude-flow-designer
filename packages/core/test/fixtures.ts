// Hit + miss fixture graphs for every workflow rule (CF0xx structural + CF6xx script).
// - "hit"  MUST produce a diagnostic with the rule's id.
// - "miss" MUST NOT produce a diagnostic with the rule's id.
// test/validation-matrix.test.ts asserts every documented rule has both fixtures
// and that doc<->code quick-fix parity holds.
import type { RuleId } from '../src/schema/types.js';
import type { WorkflowGraph, Edge } from '../src/schema/graph.js';
import type {
  WorkflowNode,
  WorkflowMetaData,
  AgentData,
  PipelineData,
  BranchData,
  LoopUntilCheckData,
  ReturnData,
  RawData,
} from '../src/schema/nodes.js';

const pos = { x: 0, y: 0 };

// --- typed node factories ----------------------------------------------------
// Each factory defaults `label` to the node id (non-empty, so CF006 never fires
// incidentally); pass an explicit label only when exercising the empty-label path.

export const n = {
  meta: (id: string, data: WorkflowMetaData, label = id): WorkflowNode => ({
    id, kind: 'workflow.meta', label, position: pos, data,
  }),
  agent: (id: string, data: AgentData, label = id): WorkflowNode => ({
    id, kind: 'agent', label, position: pos, data,
  }),
  pipeline: (id: string, data: PipelineData, label = id): WorkflowNode => ({
    id, kind: 'pipeline', label, position: pos, data,
  }),
  branch: (id: string, data: BranchData, label = id): WorkflowNode => ({
    id, kind: 'branch', label, position: pos, data,
  }),
  loop: (id: string, data: LoopUntilCheckData, label = id): WorkflowNode => ({
    id, kind: 'loopUntilCheck', label, position: pos, data,
  }),
  ret: (id: string, data: ReturnData, label = id): WorkflowNode => ({
    id, kind: 'output.return', label, position: pos, data,
  }),
  raw: (id: string, data: RawData, label = id): WorkflowNode => ({
    id, kind: 'raw', label, position: pos, data,
  }),
};

export function e(source: string, target: string, sourceHandle?: string): Edge {
  const suffix = sourceHandle ? `:${sourceHandle}` : '';
  return { id: `${source}->${target}${suffix}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) };
}

export function g(
  nodes: WorkflowNode[],
  edges: Edge[] = [],
  settings: WorkflowGraph['settings'] = {},
  meta: Partial<WorkflowGraph['meta']> = {},
): WorkflowGraph {
  return { version: 1, meta: { name: 't', slug: 't', ...meta }, settings, nodes, edges };
}

/**
 * A fully valid workflow — passes EVERY rule with zero diagnostics. Each call
 * returns a fresh graph so fixtures can mutate their own copy freely.
 * Shape: meta → agent → return.
 */
export function valid(): WorkflowGraph {
  return g(
    [
      n.meta('meta', { name: 't', description: 'A test workflow.' }),
      n.agent('a', { prompt: 'Do something useful.', label: 'a' }),
      n.ret('ret', { source: 'a', transform: 'none' }),
    ],
    [e('meta', 'a'), e('a', 'ret')],
  );
}

/** A source agent whose schema declares an array field `files` (for pipeline fixtures). */
function listAgent(): WorkflowNode {
  return n.agent('a', {
    prompt: 'List the files.',
    schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } },
  });
}

// -----------------------------------------------------------------------------
// Fixture table. Each entry: a graph that triggers the rule (hit) and one that
// does not (miss). `miss` is usually a plain valid() workflow.
// -----------------------------------------------------------------------------

export const fixtures: Record<RuleId, { hit: WorkflowGraph; miss: WorkflowGraph }> = {
  // --- graph structure (CF0xx) ----------------------------------------------
  CF001: {
    // Nodes present, no workflow.meta entry point.
    hit: g([n.agent('a', { prompt: 'x' }), n.ret('ret', { source: 'a', transform: 'none' })], [e('a', 'ret')]),
    miss: valid(),
  },
  CF002: {
    hit: g(
      [n.meta('m1', { name: 't', description: 'one' }), n.meta('m2', { name: 't', description: 'two' }),
       n.agent('a', { prompt: 'x' }), n.ret('ret', { source: 'a', transform: 'none' })],
      [e('m1', 'a'), e('a', 'ret')],
    ),
    miss: valid(),
  },
  CF003: {
    // Edge cycle a → b → a.
    hit: g(
      [n.meta('meta', { name: 't', description: 'd' }), n.agent('a', { prompt: 'x' }), n.agent('b', { prompt: 'y' })],
      [e('meta', 'a'), e('a', 'b'), e('b', 'a')],
    ),
    miss: valid(),
  },
  CF004: {
    // An extra agent with no path from meta.
    hit: g(
      [n.meta('meta', { name: 't', description: 'd' }), n.agent('a', { prompt: 'x' }),
       n.ret('ret', { source: 'a', transform: 'none' }), n.agent('orphan', { prompt: 'z' })],
      [e('meta', 'a'), e('a', 'ret')],
    ),
    miss: valid(),
  },
  CF005: {
    // An edge out of the return sink (source === output.return is disallowed).
    hit: g(
      [n.meta('meta', { name: 't', description: 'd' }), n.agent('a', { prompt: 'x' }),
       n.ret('ret', { source: 'a', transform: 'none' }), n.agent('b', { prompt: 'y' })],
      [e('meta', 'a'), e('a', 'ret'), e('ret', 'b')],
    ),
    miss: valid(),
  },
  CF006: {
    // Empty workflow description.
    hit: g(
      [n.meta('meta', { name: 't', description: '' }), n.agent('a', { prompt: 'x' }),
       n.ret('ret', { source: 'a', transform: 'none' })],
      [e('meta', 'a'), e('a', 'ret')],
    ),
    miss: valid(),
  },
  CF008: {
    hit: g(
      [n.meta('meta', { name: 'workflows', description: 'shadows a bundled command' }),
       n.agent('a', { prompt: 'x' }), n.ret('ret', { source: 'a', transform: 'none' })],
      [e('meta', 'a'), e('a', 'ret')],
      {}, { name: 'workflows', slug: 'workflows' },
    ),
    miss: valid(),
  },

  // --- workflow script (CF6xx) ----------------------------------------------
  CF601: {
    // No workflow.meta node at all.
    hit: g([n.agent('a', { prompt: 'x' }), n.ret('ret', { source: 'a', transform: 'none' })], [e('a', 'ret')]),
    miss: valid(),
  },
  CF602: {
    // meta.name is not a valid /command slug.
    hit: g(
      [n.meta('meta', { name: 'Bad Name', description: 'd' }), n.agent('a', { prompt: 'x' }),
       n.ret('ret', { source: 'a', transform: 'none' })],
      [e('meta', 'a'), e('a', 'ret')],
      {}, { name: 't', slug: 't' },
    ),
    miss: valid(),
  },
  CF604: {
    // Empty agent prompt.
    hit: g(
      [n.meta('meta', { name: 't', description: 'd' }), n.agent('a', { prompt: '' }),
       n.ret('ret', { source: 'a', transform: 'none' })],
      [e('meta', 'a'), e('a', 'ret')],
    ),
    miss: valid(),
  },
  CF605: {
    // Template ref to a node that does not exist.
    hit: g(
      [n.meta('meta', { name: 't', description: 'd' }), n.agent('a', { prompt: 'Use {{nope}} here.' }),
       n.ret('ret', { source: 'a', transform: 'none' })],
      [e('meta', 'a'), e('a', 'ret')],
    ),
    miss: valid(),
  },
  CF606: {
    // No output.return node.
    hit: g(
      [n.meta('meta', { name: 't', description: 'd' }), n.agent('a', { prompt: 'x' })],
      [e('meta', 'a')],
    ),
    miss: valid(),
  },
  CF607: {
    // Pipeline over an object-result source with no sourceField selecting a list.
    hit: g(
      [n.meta('meta', { name: 't', description: 'd' }), listAgent(),
       n.pipeline('pipe', { source: 'a', itemPrompt: 'Audit {{item}}.', itemLabel: '{{item}}' }),
       n.ret('ret', { source: 'pipe', transform: 'none' })],
      [e('meta', 'a'), e('a', 'pipe'), e('pipe', 'ret')],
    ),
    miss: valid(),
  },
  CF608: {
    // Branch with a "then" edge but no "else".
    hit: g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('review', { prompt: 'Review.', schema: { type: 'object', properties: { safe: { type: 'boolean' } } } }),
       n.branch('br', { source: 'review', field: 'safe' }),
       n.agent('approve', { prompt: 'Approve.' }),
       n.ret('ret', { source: 'review', transform: 'none' })],
      [e('meta', 'review'), e('review', 'br'), e('br', 'approve', 'then'), e('br', 'ret')],
    ),
    miss: valid(),
  },
  CF609: {
    // "request" (else arm) references "approve" (then arm) — non-linearizable.
    hit: g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.agent('review', { prompt: 'Review.', schema: { type: 'object', properties: { safe: { type: 'boolean' } } } }),
       n.branch('br', { source: 'review', field: 'safe' }),
       n.agent('approve', { prompt: 'Approve.' }),
       n.agent('request', { prompt: 'Cite {{approve}} when requesting changes.' }),
       n.ret('ret', { source: 'review', transform: 'none' })],
      [e('meta', 'review'), e('review', 'br'), e('br', 'approve', 'then'), e('br', 'request', 'else'), e('br', 'ret')],
    ),
    miss: valid(),
  },
  CF610: {
    // passField is not a property of checkSchema.
    hit: g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.loop('loop', {
         checkPrompt: 'Run the tests.',
         checkSchema: { type: 'object', properties: { passed: { type: 'boolean' } } },
         passField: 'done', fixPrompt: 'Fix the failures.', maxRounds: 2,
       }),
       n.ret('ret', { source: 'loop', transform: 'none' })],
      [e('meta', 'loop'), e('loop', 'ret')],
    ),
    miss: valid(),
  },
  CF611: {
    // meta.name disagrees with graph slug.
    hit: g(
      [n.meta('meta', { name: 'other', description: 'd' }), n.agent('a', { prompt: 'x' }),
       n.ret('ret', { source: 'a', transform: 'none' })],
      [e('meta', 'a'), e('a', 'ret')],
      {}, { name: 't', slug: 't' },
    ),
    miss: valid(),
  },
  CF613: {
    // Unknown model on an agent stage.
    hit: g(
      [n.meta('meta', { name: 't', description: 'd' }), n.agent('a', { prompt: 'x', model: 'gpt-4' }),
       n.ret('ret', { source: 'a', transform: 'none' })],
      [e('meta', 'a'), e('a', 'ret')],
    ),
    miss: valid(),
  },
  CF614: {
    // Pipeline with no itemLabel.
    hit: g(
      [n.meta('meta', { name: 't', description: 'd' }), listAgent(),
       n.pipeline('pipe', { source: 'a', sourceField: 'files', itemPrompt: 'Audit {{item}}.' }),
       n.ret('ret', { source: 'pipe', transform: 'none' })],
      [e('meta', 'a'), e('a', 'pipe'), e('pipe', 'ret')],
    ),
    miss: valid(),
  },
  CF615: {
    // Downstream .field ref on an agent that has no schema.
    hit: g(
      [n.meta('meta', { name: 't', description: 'd' }), n.agent('a', { prompt: 'Produce a result.' }),
       n.agent('b', { prompt: 'Read {{a.result}} and continue.' }),
       n.ret('ret', { source: 'b', transform: 'none' })],
      [e('meta', 'a'), e('a', 'b'), e('b', 'ret')],
    ),
    miss: valid(),
  },
  CF616: {
    // Graph contains a raw node (imported code kept verbatim).
    hit: g(
      [n.meta('meta', { name: 't', description: 'd' }),
       n.raw('raw', { code: 'const merged = [].flat()\nreturn merged', produces: ['merged'] }, 'code')],
      [e('meta', 'raw')],
    ),
    miss: valid(),
  },
};
