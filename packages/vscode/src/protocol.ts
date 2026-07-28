// Typed message protocol for the webview ↔ extension-host channel. Pure types +
// guards, no `vscode` import, so both sides share one contract and it unit-tests.
// The webview renders the canvas and owns the graph; the extension host owns all
// filesystem access (custom-editor document I/O, export, import, run).
import type { GeneratedFile, WorkflowGraph } from '@clauflow/core';

/** Messages the webview posts TO the extension host. */
export type WebviewToHost =
  | { type: 'ready' } // webview mounted; host replies with 'load'
  | { type: 'edit'; graph: WorkflowGraph } // graph changed → host updates the document
  | { type: 'export'; files: GeneratedFile[] } // request write to workspace .claude
  | { type: 'import' } // request: read workspace .claude → graph
  | { type: 'run'; command: string } // request: open a terminal running this command
  | { type: 'notify'; level: NotifyLevel; message: string };

/** Messages the extension host posts TO the webview. */
export type HostToWebview =
  | { type: 'load'; graph: WorkflowGraph } // initial / external document content
  | { type: 'imported'; graph: WorkflowGraph } // result of an import request
  | { type: 'exported'; written: string[]; skipped: string[] }
  | { type: 'error'; message: string };

export type NotifyLevel = 'info' | 'warn' | 'error';

export function isWebviewToHost(m: unknown): m is WebviewToHost {
  if (!m || typeof m !== 'object' || typeof (m as { type?: unknown }).type !== 'string') return false;
  const t = (m as { type: string }).type;
  return ['ready', 'edit', 'export', 'import', 'run', 'notify'].includes(t);
}

export function isHostToWebview(m: unknown): m is HostToWebview {
  if (!m || typeof m !== 'object' || typeof (m as { type?: unknown }).type !== 'string') return false;
  const t = (m as { type: string }).type;
  return ['load', 'imported', 'exported', 'error'].includes(t);
}
