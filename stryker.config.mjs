// Mutation testing config. Scope is exactly what brief M1 names: the two
// correctness-critical subsystems, validate.ts and codegen/. (The CFxxx rule
// modules already have exhaustive hit+miss+quick-fix fixtures from M0; they are
// out of the M1 mutation-scope line.) Break threshold 80% is the M2 entry gate
// (SPEC-REVIEW "Metrics of reviewed enough").
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  reporters: ['clear-text', 'progress'],
  coverageAnalysis: 'perTest',
  mutate: [
    'packages/core/src/validate.ts',
    'packages/core/src/codegen/**/*.ts',
    'packages/core/src/importer.ts',
  ],
  thresholds: { high: 90, low: 80, break: 80 },
  vitest: { configFile: 'vitest.config.ts' },
};
