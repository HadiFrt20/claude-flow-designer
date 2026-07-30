// Design tokens (DESIGN-BRIEF.md). Components reference these NAMES, never raw
// values. Surfaces/text map 1:1 to --vscode-* CSS custom properties; the web app
// defines the same properties on :root (dark-first). Category accents are the only
// saturated colors and appear only as a 2px left node border + port dots + minimap.
import type { NodeKind } from '@clauflow/core';

/** The visual categories a workflow node kind maps to. */
export type NodeCategory = 'meta' | 'agent' | 'pipeline' | 'control' | 'raw';

export function categoryOf(kind: NodeKind): NodeCategory {
  if (kind === 'workflow.meta') return 'meta';
  if (kind === 'agent') return 'agent';
  if (kind === 'pipeline' || kind === 'parallel') return 'pipeline'; // both fan out
  if (kind === 'raw') return 'raw';
  // branch, loopUntilCheck, output.return — control flow / terminals.
  return 'control';
}

/** `/command`-style prefix glyph per category (node headers read like a config file). */
export const CATEGORY_GLYPH: Record<NodeCategory, string> = {
  meta: '▸',
  agent: '·',
  pipeline: '❖',
  control: '◆',
  raw: '{ }',
};

// Accent colors (ANSI-inspired). Exposed as CSS variables so the extension can
// override per-theme; these are the web-app dark-first fallbacks.
export const ACCENT: Record<NodeCategory, string> = {
  meta: 'var(--cf-accent-meta, #d7a65f)', // amber
  agent: 'var(--cf-accent-agent, #4ec9d4)', // cyan
  pipeline: 'var(--cf-accent-pipeline, #b48ead)', // violet
  control: 'var(--cf-accent-control, #d16969)', // red
  raw: 'var(--cf-accent-raw, #808080)', // grey — verbatim, non-visual
};

/** Surface/text/diagnostic tokens → --vscode-* with web fallbacks (dark-first). */
export const TOKENS = {
  surface: 'var(--vscode-editor-background, #1e1e1e)',
  surfaceRaised: 'var(--vscode-editorWidget-background, #252526)',
  border: 'var(--vscode-editorWidget-border, #3c3c3c)',
  text: 'var(--vscode-editor-foreground, #d4d4d4)',
  textMuted: 'var(--vscode-descriptionForeground, #8c8c8c)',
  focusRing: 'var(--vscode-focusBorder, #007fd4)',
  error: 'var(--vscode-editorError-foreground, #f14c4c)',
  warn: 'var(--vscode-editorWarning-foreground, #cca700)',
  info: 'var(--vscode-editorInfo-foreground, #3794ff)',
  uiFont: 'var(--vscode-font-family, system-ui, sans-serif)',
  monoFont: 'var(--vscode-editor-font-family, "SF Mono", Menlo, Consolas, monospace)',
} as const;

/** 4px spacing grid; node radius 4, input radius 2 (DESIGN-BRIEF spacing). */
export const SPACE = (n: number): string => `${n * 4}px`;
export const RADIUS = { node: '4px', input: '2px' } as const;

export type Severity = 'error' | 'warn' | 'info';

/** Diagnostic badges carry an icon (no color-only meaning; a11y quality floor). */
export const SEVERITY_ICON: Record<Severity, string> = {
  error: '✕',
  warn: '▲',
  info: 'ℹ',
};

export const SEVERITY_COLOR: Record<Severity, string> = {
  error: TOKENS.error,
  warn: TOKENS.warn,
  info: TOKENS.info,
};
