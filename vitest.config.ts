import { defineConfig } from 'vitest/config';

// Explicit config so the Stryker vitest-runner can discover the suite. Mirrors
// the default `vitest run` behaviour used by `npm test`. Canvas tests need a DOM;
// core tests stay on node (faster, and Stryker mutates only core).
export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [['packages/canvas/**', 'jsdom']],
    setupFiles: ['./packages/canvas/test/setup.ts'],
  },
});
