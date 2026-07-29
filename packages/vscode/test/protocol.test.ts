import { describe, it, expect } from 'vitest';
import { isWebviewToHost, isHostToWebview } from '../src/protocol.js';

describe('message guards', () => {
  it('accepts valid webview→host messages', () => {
    expect(isWebviewToHost({ type: 'ready' })).toBe(true);
    expect(isWebviewToHost({ type: 'edit', graph: {} })).toBe(true);
    expect(isWebviewToHost({ type: 'export', files: [] })).toBe(true);
    expect(isWebviewToHost({ type: 'notify', level: 'info', message: 'x' })).toBe(true);
  });

  it('rejects the retired run message (run is a command, not a webview message)', () => {
    expect(isWebviewToHost({ type: 'run', command: 'claude -p x' })).toBe(false);
  });

  it('accepts valid host→webview messages', () => {
    expect(isHostToWebview({ type: 'load', graph: {} })).toBe(true);
    expect(isHostToWebview({ type: 'exported', written: [], skipped: [] })).toBe(true);
  });

  it('rejects cross-direction and malformed messages', () => {
    expect(isWebviewToHost({ type: 'load', graph: {} })).toBe(false); // host→webview
    expect(isHostToWebview({ type: 'edit', graph: {} })).toBe(false); // webview→host
    expect(isWebviewToHost(null)).toBe(false);
    expect(isWebviewToHost({})).toBe(false);
    expect(isWebviewToHost({ type: 42 })).toBe(false);
    expect(isHostToWebview('load')).toBe(false);
  });
});
