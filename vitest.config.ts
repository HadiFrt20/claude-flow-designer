import { defineConfig } from 'vitest/config';

// Explicit config so the Stryker vitest-runner can discover the suite. Mirrors
// the default `vitest run` behaviour used by `npm test`.
export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts'],
  },
});
