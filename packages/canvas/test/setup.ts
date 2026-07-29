import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom lacks ResizeObserver / matchMedia, which React Flow requires. Minimal
// stubs so canvas components mount in tests.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
if (typeof globalThis.matchMedia !== 'function') {
  globalThis.matchMedia = (() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })) as unknown as typeof globalThis.matchMedia;
}
// React Flow reads DOMMatrixReadOnly for transforms.
if (typeof globalThis.DOMMatrixReadOnly !== 'function') {
  globalThis.DOMMatrixReadOnly = class {
    m22 = 1;
    constructor() {}
  } as unknown as typeof DOMMatrixReadOnly;
}

// Unmount React trees between tests. Auto-cleanup only registers when vitest
// `globals` is on; we keep globals off, so wire it explicitly to prevent DOM
// leakage (which surfaces as spurious "found multiple elements" failures).
afterEach(() => cleanup());
