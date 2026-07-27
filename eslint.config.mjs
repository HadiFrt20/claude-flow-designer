import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.vsix'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node scripts (build/codegen tooling) run under Node — expose its globals.
    files: ['**/*.mjs', '**/scripts/**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['packages/**/*.{ts,tsx}'],
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
