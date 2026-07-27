// Mutation testing config. Scope: the two correctness-critical subsystems named
// in brief M1 — packages/core/src/validate.ts and the rule + codegen modules.
// Threshold ≥80% is the M2 entry criterion (SPEC-REVIEW "Metrics of reviewed enough").
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  reporters: ['clear-text', 'progress'],
  coverageAnalysis: 'perTest',
  mutate: [
    'packages/core/src/validate.ts',
    'packages/core/src/rules/**/*.ts',
    'packages/core/src/codegen/**/*.ts',
    // exclude pure type-only helpers that carry no runtime logic
    '!packages/core/src/codegen/model.ts',
  ],
  thresholds: { high: 90, low: 80, break: 80 },
  vitest: { configFile: 'vitest.config.ts' },
};
