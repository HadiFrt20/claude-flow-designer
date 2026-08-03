// Template gallery: ready-to-use starter dynamic workflows. Real, valid graphs
// (they pass the export gate) that double as codegen fixtures — the CI drift check
// regenerates their .js under fixtures/ and diffs against the committed copy.
// Shapes mirror docs/en/workflows: single agent, fan-out+merge, loop-until-check,
// branch-on-review, args-driven pipeline.
import type { WorkflowGraph } from './schema/graph.js';
import type { WorkflowNode } from './schema/nodes.js';

const P = { x: 0, y: 0 };
const node = (n: WorkflowNode): WorkflowNode => n;

// --- audit-routes: discover → fan-out audit → return -----------------------
const auditRoutes: WorkflowGraph = {
  version: 1,
  meta: { name: 'Audit Routes', slug: 'audit-routes', description: 'Audit route handlers for missing auth' },
  settings: {},
  nodes: [
    node({ id: 'meta', kind: 'workflow.meta', label: 'Audit Routes', position: P, data: { name: 'audit-routes', description: 'Audit route handlers for missing auth' } }),
    node({
      id: 'list', kind: 'agent', label: 'List routes', position: P,
      data: {
        prompt: 'List every .ts file under src/routes/.',
        schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } },
      },
    }),
    node({
      id: 'audit', kind: 'pipeline', label: 'Audit routes', position: P,
      data: { source: 'list', sourceField: 'files', itemPrompt: 'Audit {{item}} for missing authentication checks.', itemLabel: '{{item}}' },
    }),
    node({ id: 'ret', kind: 'output.return', label: 'return', position: P, data: { source: 'audit', transform: 'filterBoolean' } }),
  ],
  edges: [
    { id: 'e1', source: 'meta', target: 'list' },
    { id: 'e2', source: 'list', target: 'audit' },
    { id: 'e3', source: 'audit', target: 'ret' },
  ],
};

// --- single-agent: the smallest useful workflow ----------------------------
const summarize: WorkflowGraph = {
  version: 1,
  meta: { name: 'Summarize', slug: 'summarize', description: 'Summarize the input in three bullets' },
  settings: {},
  nodes: [
    node({ id: 'meta', kind: 'workflow.meta', label: 'Summarize', position: P, data: { name: 'summarize', description: 'Summarize the input in three bullets', argsHint: 'the text to summarize' } }),
    node({ id: 'sum', kind: 'agent', label: 'Summarize', position: P, data: { prompt: 'Summarize the following in three bullets:\n{{args}}', label: 'summarize' } }),
    node({ id: 'ret', kind: 'output.return', label: 'return', position: P, data: { source: 'sum', transform: 'none' } }),
  ],
  edges: [
    { id: 'e1', source: 'meta', target: 'sum' },
    { id: 'e2', source: 'sum', target: 'ret' },
  ],
};

// --- test-fix: loop-until-check --------------------------------------------
const testFix: WorkflowGraph = {
  version: 1,
  meta: { name: 'Test Fix', slug: 'test-fix', description: 'Run tests and fix failures until green' },
  settings: {},
  nodes: [
    node({ id: 'meta', kind: 'workflow.meta', label: 'Test Fix', position: P, data: { name: 'test-fix', description: 'Run tests and fix failures until green' } }),
    node({
      id: 'loop', kind: 'loopUntilCheck', label: 'Fix loop', position: P,
      data: {
        checkPrompt: 'Run the test suite and report whether it passed.',
        checkSchema: { type: 'object', properties: { passed: { type: 'boolean' }, progress: { type: 'number' } } },
        passField: 'passed',
        fixPrompt: 'Fix the failures reported: {{check}}.',
        maxRounds: 2,
      },
    }),
    node({ id: 'ret', kind: 'output.return', label: 'return', position: P, data: { source: 'loop', transform: 'none' } }),
  ],
  edges: [
    { id: 'e1', source: 'meta', target: 'loop' },
    { id: 'e2', source: 'loop', target: 'ret' },
  ],
};

// --- branch-review: review, then branch on the verdict ---------------------
const branchReview: WorkflowGraph = {
  version: 1,
  meta: { name: 'Branch Review', slug: 'branch-review', description: 'Review a change and act on the verdict' },
  settings: {},
  nodes: [
    node({ id: 'meta', kind: 'workflow.meta', label: 'Branch Review', position: P, data: { name: 'branch-review', description: 'Review a change and act on the verdict' } }),
    node({
      id: 'review', kind: 'agent', label: 'Review', position: P,
      data: { prompt: 'Review the current diff. Report whether it is safe to merge.', schema: { type: 'object', properties: { safe: { type: 'boolean' } } }, label: 'review' },
    }),
    node({ id: 'br', kind: 'branch', label: 'safe?', position: P, data: { source: 'review', field: 'safe' } }),
    node({ id: 'approve', kind: 'agent', label: 'Approve', position: P, data: { prompt: 'Draft an approving PR comment.', label: 'approve' } }),
    node({ id: 'request', kind: 'agent', label: 'Request changes', position: P, data: { prompt: 'Draft a request-changes PR comment citing {{review}}.', label: 'request' } }),
    node({ id: 'ret', kind: 'output.return', label: 'return', position: P, data: { source: 'review', transform: 'none' } }),
  ],
  edges: [
    { id: 'e1', source: 'meta', target: 'review' },
    { id: 'e2', source: 'review', target: 'br' },
    { id: 'e3', source: 'br', target: 'approve', sourceHandle: 'then' },
    { id: 'e4', source: 'br', target: 'request', sourceHandle: 'else' },
    { id: 'e5', source: 'br', target: 'ret' },
  ],
};

// --- args-pipeline: fan out directly over args -----------------------------
const gradePrs: WorkflowGraph = {
  version: 1,
  meta: { name: 'Grade PRs', slug: 'grade-prs', description: 'Grade each PR number passed in args' },
  settings: {},
  nodes: [
    node({ id: 'meta', kind: 'workflow.meta', label: 'Grade PRs', position: P, data: { name: 'grade-prs', description: 'Grade each PR number passed in args', argsHint: 'an array of PR numbers' } }),
    node({
      id: 'grade', kind: 'pipeline', label: 'Grade PR', position: P,
      data: { source: 'args', itemPrompt: 'Grade PR #{{item}} for review quality (0-10) with a one-line reason.', itemLabel: 'PR {{item}}' },
    }),
    node({ id: 'ret', kind: 'output.return', label: 'return', position: P, data: { source: 'grade', transform: 'none' } }),
  ],
  edges: [
    { id: 'e1', source: 'meta', target: 'grade' },
    { id: 'e2', source: 'grade', target: 'ret' },
  ],
};

// --- review-dims: concurrent fan-out (parallel) + passthrough opts ----------
const reviewDims: WorkflowGraph = {
  version: 1,
  meta: { name: 'Review Dims', slug: 'review-dims', description: 'Review each dimension concurrently, then merge' },
  settings: {},
  nodes: [
    node({ id: 'meta', kind: 'workflow.meta', label: 'Review Dims', position: P, data: { name: 'review-dims', description: 'Review each dimension concurrently, then merge' } }),
    node({
      id: 'list', kind: 'agent', label: 'List dimensions', position: P,
      data: { prompt: 'List the review dimensions.', schema: { type: 'object', required: ['dims'], properties: { dims: { type: 'array', items: { type: 'string' } } } } },
    }),
    node({
      id: 'review', kind: 'parallel', label: 'Review each', position: P,
      // itemVar 'd', a per-item field ref, a passthrough opt (phase), and a model — exercises the full parallel emit path.
      data: { source: 'list', sourceField: 'dims', itemVar: 'd', itemPrompt: 'Review dimension {{d}} of {{list}}.', itemLabel: 'review:{{d}}', extraOpts: { phase: "'Review'" } },
    }),
    node({ id: 'ret', kind: 'output.return', label: 'return', position: P, data: { source: 'review', transform: 'filterBoolean' } }),
  ],
  edges: [
    { id: 'e1', source: 'meta', target: 'list' },
    { id: 'e2', source: 'list', target: 'review' },
    { id: 'e3', source: 'review', target: 'ret' },
  ],
};

// --- poc-phases: M9 structural view — phase groups + a condExpr branch ------
const pocPhases: WorkflowGraph = {
  version: 1,
  meta: { name: 'PoC Phases', slug: 'poc-phases', description: 'A phased build with a verify branch' },
  settings: {},
  nodes: [
    node({ id: 'meta', kind: 'workflow.meta', label: 'PoC Phases', position: P, data: { name: 'poc-phases', description: 'A phased build with a verify branch' } }),
    node({ id: 'phUnderstand', kind: 'phase', label: 'understand', position: P, data: { title: 'Understand' } }),
    node({ id: 'spec', kind: 'agent', label: 'Spec', position: P, parentId: 'phUnderstand', data: { prompt: 'Write a spec for {{args}}.', label: 'spec' } }),
    node({ id: 'phVerify', kind: 'phase', label: 'verify', position: P, data: { title: 'Verify' } }),
    node({ id: 'check', kind: 'agent', label: 'Check', position: P, parentId: 'phVerify', data: { prompt: 'Verify {{spec}}.', label: 'check', schema: { type: 'object', properties: { failing: { type: 'boolean' } } } } }),
    node({ id: 'br', kind: 'branch', label: 'failing?', position: P, parentId: 'phVerify', data: { condExpr: 'check.failing' } }),
    node({ id: 'repair', kind: 'agent', label: 'Repair', position: P, parentId: 'phVerify', data: { prompt: 'Repair the failures in {{check}}.', label: 'repair' } }),
    node({ id: 'ret', kind: 'output.return', label: 'return', position: P, data: { source: 'check', transform: 'none' } }),
  ],
  edges: [
    { id: 'e1', source: 'meta', target: 'phUnderstand' },
    { id: 'e2', source: 'phUnderstand', target: 'spec' },
    { id: 'e3', source: 'spec', target: 'phVerify' },
    { id: 'e4', source: 'phVerify', target: 'check' },
    { id: 'e5', source: 'check', target: 'br' },
    { id: 'e6', source: 'br', target: 'repair', sourceHandle: 'then' },
    { id: 'e7', source: 'br', target: 'ret' },
  ],
};

// --- draft-angles: static-array fan-out of independent angles (M10 fanout) ---
const draftAngles: WorkflowGraph = {
  version: 1,
  meta: { name: 'Draft Angles', slug: 'draft-angles', description: 'Draft a plan from several angles concurrently, then merge' },
  settings: {},
  nodes: [
    node({ id: 'meta', kind: 'workflow.meta', label: 'Draft Angles', position: P, data: { name: 'draft-angles', description: 'Draft a plan from several angles concurrently, then merge' } }),
    node({
      id: 'angles', kind: 'fanout', label: 'Draft angles', position: P,
      data: {
        mode: 'parallel',
        branches: [
          { kind: 'thunk', prompt: 'Draft the plan optimizing for speed.', label: 'speed' },
          { kind: 'thunk', prompt: 'Draft the plan optimizing for safety.', label: 'safety' },
          { kind: 'thunk', prompt: 'Draft the plan optimizing for cost.', label: 'cost' },
        ],
      },
    }),
    node({ id: 'merge', kind: 'agent', label: 'Merge', position: P, data: { prompt: 'Weigh the drafts in {{angles}} and pick the best synthesis.', label: 'merge' } }),
    node({ id: 'ret', kind: 'output.return', label: 'return', position: P, data: { source: 'merge', transform: 'none' } }),
  ],
  edges: [
    { id: 'e1', source: 'meta', target: 'angles' },
    { id: 'e2', source: 'angles', target: 'merge' },
    { id: 'e3', source: 'merge', target: 'ret' },
  ],
};

export interface Template {
  slug: string;
  title: string;
  graph: WorkflowGraph;
}

export const TEMPLATES: Template[] = [
  { slug: 'audit-routes', title: 'Audit Routes (fan-out)', graph: auditRoutes },
  { slug: 'summarize', title: 'Summarize (single agent)', graph: summarize },
  { slug: 'test-fix', title: 'Test-Fix (loop)', graph: testFix },
  { slug: 'branch-review', title: 'Branch Review', graph: branchReview },
  { slug: 'grade-prs', title: 'Grade PRs (args pipeline)', graph: gradePrs },
  { slug: 'review-dims', title: 'Review Dims (parallel)', graph: reviewDims },
  { slug: 'poc-phases', title: 'PoC Phases (phase groups + branch)', graph: pocPhases },
  { slug: 'draft-angles', title: 'Draft Angles (static fan-out)', graph: draftAngles },
];
