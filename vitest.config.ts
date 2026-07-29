import { defineConfig } from 'vitest/config';

// Explicit config so the Stryker vitest-runner can discover the suite. Mirrors
// the default `vitest run` behaviour used by `npm test`. Canvas tests need a DOM;
// core tests stay on node (faster, and Stryker mutates only core).
export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.{ts,tsx}'],
    // canvas + web tests need a DOM; core stays on node (faster; Stryker scope).
    environmentMatchGlobs: [
      ['packages/canvas/**', 'jsdom'],
      ['packages/web/**', 'jsdom'],
    ],
    // Global setup only carries canvas's RTL/jsdom polyfills. Web tests import
    // fake-indexeddb themselves (see packages/web/test/setup.ts) so the node-only
    // core suite never loads DOM shims.
    setupFiles: ['./packages/canvas/test/setup.ts'],
  },
});
