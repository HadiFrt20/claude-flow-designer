// Design tokens (DESIGN-BRIEF.md). Components reference these NAMES, never raw
// values. Surfaces/text map 1:1 to --vscode-* CSS custom properties; the web app
// defines the same properties on :root (dark-first). Category accents are the only
// saturated colors and appear only as a 2px left node border + port dots + minimap.
import type { NodeKind } from '@clauflow/core';

/** The five visual categories a node kind maps to. */
export type NodeCategory = 'trigger' | 'step' | 'subagent' | 'hookHandler' | 'control';

export function categoryOf(kind: NodeKind): NodeCategory {
  if (kind.startsWith('trigger.')) return 'trigger';
  if (kind === 'step.subagent') return 'subagent';
  if (kind.startsWith('hook.')) return 'hookHandler';
  if (kind === 'gate.condition' || kind === 'output.decision') return 'control';
  return 'step';
}

/** `/command`-style prefix glyph per category (node headers read like a config file). */
export const CATEGORY_GLYPH: Record<NodeCategory, string> = {
  trigger: '▸',
  step: '·',
  subagent: '❖',
  hookHandler: '⎈',
  control: '◆',
};

// Accent colors (ANSI-inspired). Exposed as CSS variables so the extension can
// override per-theme; these are the web-app dark-first fallbacks.
export const ACCENT: Record<NodeCategory, string> = {
  trigger: 'var(--cf-accent-trigger, #d7a65f)', // amber
  step: 'var(--cf-accent-step, #4ec9d4)', // cyan
  subagent: 'var(--cf-accent-subagent, #b48ead)', // violet
  hookHandler: 'var(--cf-accent-hook, #6a9955)', // green
  control: 'var(--cf-accent-control, #d16969)', // red
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
