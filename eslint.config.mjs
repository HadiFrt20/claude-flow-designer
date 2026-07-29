import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/dist-tsc/**', '**/node_modules/**', '**/*.vsix'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node scripts (build/codegen tooling) run under Node — expose its globals.
    files: ['**/*.mjs', '**/scripts/**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    // Config files (vite/vitest/etc.) require a default export by contract.
    files: ['**/*.config.{ts,js,mjs}'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['packages/**/*.{ts,tsx}'],
    ignores: ['**/*.config.{ts,js,mjs}'],
    rules: {
      // No default exports — enforced by CLAUDE.md hard rules.
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportDefaultDeclaration', message: 'No default exports (CLAUDE.md).' },
      ],
      // Allow intentionally-unused args prefixed with _ (e.g. stub host methods).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
