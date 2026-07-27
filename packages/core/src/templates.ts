// Template gallery: ready-to-use starter workflows. These are real, valid graphs
// (they pass the export gate) and double as codegen fixtures — the CI drift check
// regenerates their output under fixtures/ and diffs against the committed copy.
// SPEC brief M1: pr-review, smart-commit, test-fix-loop, security-gate,
// session-context-loader.
import type { WorkflowGraph } from './schema/graph.js';
import type { WorkflowNode } from './schema/nodes.js';

const P = { x: 0, y: 0 };

function node(n: WorkflowNode): WorkflowNode {
  return n;
}

// --- pr-review: a slash command that embeds the diff and asks for a review -----
const prReview: WorkflowGraph = {
  version: 1,
  meta: { name: 'PR Review', slug: 'pr-review', description: 'Review the current diff for issues' },
  settings: {
    model: 'sonnet',
    permissions: { allow: ['Bash(git diff *)', 'Bash(git log *)'], deny: [], ask: [] },
  },
  nodes: [
    node({
      id: 'cmd', kind: 'trigger.slashCommand', label: 'pr-review', position: P,
      data: {
        name: 'pr-review',
        description: 'Review the staged/committed diff and report issues by severity.',
        args: [{ name: 'base', placeholder: '$1' }],
        argumentHint: '[base-branch]',
      },
    }),
    node({
      id: 'diff', kind: 'step.shell', label: 'diff', position: P,
      data: { command: 'git diff $1...HEAD', embedOutput: true },
    }),
    node({
      id: 'ask', kind: 'step.prompt', label: 'review', position: P,
      data: {
        body: 'Review the diff above against $1. List findings grouped by severity (blocker/major/minor), each with file:line and a concrete fix.',
      },
    }),
  ],
  edges: [
    { id: 'e1', source: 'cmd', target: 'diff' },
    { id: 'e2', source: 'diff', target: 'ask' },
  ],
};

// --- smart-commit: stage, summarize, and propose a conventional commit ----------
const smartCommit: WorkflowGraph = {
  version: 1,
  meta: { name: 'Smart Commit', slug: 'smart-commit', description: 'Draft a conventional commit from staged changes' },
  settings: { permissions: { allow: ['Bash(git status *)', 'Bash(git diff *)'], deny: [], ask: [] } },
  nodes: [
    node({
      id: 'cmd', kind: 'trigger.slashCommand', label: 'smart-commit', position: P,
      data: {
        name: 'smart-commit',
        description: 'Summarize staged changes and propose a conventional-commit message.',
      },
    }),
    node({
      id: 'status', kind: 'step.shell', label: 'status', position: P,
      data: { command: 'git status --short', embedOutput: true },
    }),
    node({
      id: 'staged', kind: 'step.shell', label: 'staged diff', position: P,
      data: { command: 'git diff --cached', embedOutput: true },
    }),
    node({
      id: 'draft', kind: 'step.prompt', label: 'draft', position: P,
      data: {
        body: 'From the staged changes above, propose ONE conventional-commit message (type(scope): subject) plus a short body. Do not run git commit.',
      },
    }),
  ],
  edges: [
    { id: 'e1', source: 'cmd', target: 'status' },
    { id: 'e2', source: 'status', target: 'staged' },
    { id: 'e3', source: 'staged', target: 'draft' },
  ],
};

// --- test-fix-loop: headless runner that runs tests and fixes failures ----------
const testFixLoop: WorkflowGraph = {
  version: 1,
  meta: {
    name: 'Test-Fix Loop',
    slug: 'test-fix-loop',
    description: 'Headless: run tests, fix failures, repeat',
    // stream-json is intentional here (the runner streams progress); ack CF502.
    ackedWarnings: ['CF502'],
  },
  settings: {
    model: 'sonnet',
    permissions: { allow: ['Bash(npm test *)', 'Bash(npm run *)', 'Edit'], deny: [], ask: [] },
    headless: { enabled: true, outputFormat: 'stream-json', maxTurns: 40, verbose: true },
  },
  nodes: [
    node({
      id: 'run', kind: 'trigger.headless', label: 'runner', position: P,
      data: {
        promptTemplate: 'Run the test suite. For each failing test, diagnose and fix the code, then re-run until green. Do not weaken assertions.',
      },
    }),
    node({
      id: 'step', kind: 'step.prompt', label: 'loop', position: P,
      data: { body: 'Iterate: run tests → read the first failure → fix → re-run.' },
    }),
  ],
  edges: [{ id: 'e1', source: 'run', target: 'step' }],
};

// --- security-gate: PreToolUse hook that denies destructive Bash --------------
const securityGate: WorkflowGraph = {
  version: 1,
  meta: { name: 'Security Gate', slug: 'security-gate', description: 'Deny destructive shell commands via a PreToolUse hook' },
  settings: { permissions: { allow: [], deny: ['Bash(rm -rf *)'], ask: [] } },
  nodes: [
    node({
      id: 'trg', kind: 'trigger.hookEvent', label: 'pre-bash', position: P,
      data: { event: 'PreToolUse', matcher: 'Bash', scope: 'project' },
    }),
    node({
      id: 'guard', kind: 'hook.command', label: 'guard', position: P,
      data: {
        command: 'bash',
        scriptBody:
          'cmd=$(jq -r \'.tool_input.command // ""\' <<<"$input")\nif printf \'%s\' "$cmd" | grep -Eq \'rm[[:space:]]+-rf|:\\(\\)\\{\'; then\n  blocked=1\nelse\n  blocked=0\nfi\nif [ "$blocked" -eq 0 ]; then exit 0; fi',
      },
    }),
    node({
      id: 'deny', kind: 'output.decision', label: 'deny', position: P,
      data: { mode: 'deny', reason: 'Destructive command blocked by the security gate.', blockStyle: 'json' },
    }),
  ],
  edges: [
    { id: 'e1', source: 'trg', target: 'guard' },
    { id: 'e2', source: 'guard', target: 'deny' },
  ],
};

// --- session-context-loader: SessionStart hook injecting repo context ----------
const sessionContextLoader: WorkflowGraph = {
  version: 1,
  meta: {
    name: 'Session Context Loader',
    slug: 'session-context-loader',
    description: 'Inject repo status into context at session start',
  },
  settings: {},
  nodes: [
    node({
      id: 'trg', kind: 'trigger.sessionStart', label: 'on start', position: P,
      data: { matcher: 'startup' },
    }),
    node({
      id: 'load', kind: 'hook.command', label: 'load context', position: P,
      data: {
        command: 'bash',
        scriptBody:
          'ctx=$(git -C "$CLAUDE_PROJECT_DIR" status --short 2>/dev/null || echo "no git")\nprintf \'%s\' "$ctx" > /tmp/clauflow-ctx.txt',
      },
    }),
    node({
      id: 'note', kind: 'output.decision', label: 'add context', position: P,
      data: { mode: 'allow', additionalContext: 'Repo status loaded at session start.' },
    }),
  ],
  edges: [
    { id: 'e1', source: 'trg', target: 'load' },
    { id: 'e2', source: 'load', target: 'note' },
  ],
};

export interface Template {
  slug: string;
  title: string;
  graph: WorkflowGraph;
}

export const TEMPLATES: Template[] = [
  { slug: 'pr-review', title: 'PR Review', graph: prReview },
  { slug: 'smart-commit', title: 'Smart Commit', graph: smartCommit },
  { slug: 'test-fix-loop', title: 'Test-Fix Loop', graph: testFixLoop },
  { slug: 'security-gate', title: 'Security Gate', graph: securityGate },
  { slug: 'session-context-loader', title: 'Session Context Loader', graph: sessionContextLoader },
];
