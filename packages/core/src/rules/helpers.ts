// Shared helpers for validation rules: Claude Code semantics distilled from
// docs/SPEC-CODEGEN.md and docs/REFERENCE-CLAUDE-CODE.md. Keep citations in comments.

const DOCS = 'https://code.claude.com/docs/en';
export const DOCS_URLS = {
  workflows: `${DOCS}/workflows`,
  subAgents: `${DOCS}/sub-agents`,
  modelConfig: `${DOCS}/model-config`,
} as const;

/** Known model aliases + representative IDs (CF613). Data-only; easy to extend. */
export const KNOWN_MODELS: ReadonlySet<string> = new Set([
  // aliases
  'opus', 'sonnet', 'haiku', 'fable',
  // representative IDs (kept loose; exact IDs evolve)
  'claude-opus-5', 'claude-sonnet-5', 'claude-fable-5', 'claude-haiku-4-5-20251001',
  'claude-opus-4-8', 'claude-opus-4-8[1m]',
]);
