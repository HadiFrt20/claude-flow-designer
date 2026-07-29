// Webview entry: mounts the shared Designer and bridges to the extension host
// over postMessage. The host owns the filesystem; the webview owns the graph.
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Designer, EditorStore } from '@clauflow/canvas';
import type { HostBridge, WriteResult } from '@clauflow/canvas';
import { serializeGraph } from '@clauflow/core';
import type { GeneratedFile, WorkflowGraph } from '@clauflow/core';
import { isHostToWebview } from '../src/protocol.js';
import type { WebviewToHost } from '../src/protocol.js';

interface VsCodeApi {
  postMessage(msg: WebviewToHost): void;
  getState(): unknown;
  setState(s: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

function post(msg: WebviewToHost) {
  vscode.postMessage(msg);
}

/**
 * HostBridge implemented over postMessage. writeFiles/readProject are fire-and-
 * await: the host does the fs work and replies, and we resolve the pending
 * promise when the matching message arrives.
 */
class VsCodeHostBridge implements HostBridge {
  private pendingImport: ((g: WorkflowGraph | null) => void) | null = null;
  private pendingExport: ((r: WriteResult) => void) | null = null;

  handleMessage(msg: unknown): void {
    if (!isHostToWebview(msg)) return;
    if (msg.type === 'imported' && this.pendingImport) {
      this.pendingImport(msg.graph);
      this.pendingImport = null;
    } else if (msg.type === 'exported' && this.pendingExport) {
      this.pendingExport({ written: msg.written, skipped: msg.skipped, errors: [] });
      this.pendingExport = null;
    } else if (msg.type === 'error') {
      this.pendingImport?.(null);
      this.pendingExport?.({ written: [], skipped: [], errors: [msg.message] });
      this.pendingImport = null;
      this.pendingExport = null;
    }
  }

  writeFiles(files: GeneratedFile[], opts?: { dryRun?: boolean }): Promise<WriteResult> {
    if (opts?.dryRun) {
      return Promise.resolve({ written: files.map((f) => f.path), skipped: [], errors: [] });
    }
    return new Promise((resolve) => {
      this.pendingExport = resolve;
      post({ type: 'export', files });
    });
  }

  readProject(): Promise<WorkflowGraph | null> {
    return new Promise((resolve) => {
      this.pendingImport = resolve;
      post({ type: 'import' });
    });
  }

  openFile(): void {
    /* the host editor already shows files; no-op in the webview */
  }

  notify(level: 'info' | 'warn' | 'error', message: string): void {
    post({ type: 'notify', level, message });
  }
}

function Root() {
  const [store, setStore] = useState<EditorStore | null>(null);
  const [bridge] = useState(() => new VsCodeHostBridge());
  const storeRef = useRef<EditorStore | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const msg = e.data;
      bridge.handleMessage(msg);
      if (!isHostToWebview(msg) || msg.type !== 'load') return;

      const existing = storeRef.current;
      if (!existing) {
        // First load: create the store and wire edit-persist once.
        const s = new EditorStore(msg.graph);
        s.subscribe(() => post({ type: 'edit', graph: s.current }));
        storeRef.current = s;
        setStore(s);
      } else if (serializeGraph(msg.graph) !== serializeGraph(existing.current)) {
        // Genuine external change: replace content IN PLACE (keeps the store
        // instance + its subscription; the host already suppresses self-echoes).
        // Compare via canonical serialization so key-order/whitespace differences
        // don't trip a redundant reset.
        existing.replaceGraph(msg.graph);
      }
    };
    window.addEventListener('message', onMessage);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, [bridge]);

  if (!store) return <div style={{ padding: 16, fontFamily: 'var(--vscode-font-family)' }}>Loading workflow…</div>;
  return <Designer store={store} host={bridge} />;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><Root /></StrictMode>);
