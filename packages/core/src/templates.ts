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
];
