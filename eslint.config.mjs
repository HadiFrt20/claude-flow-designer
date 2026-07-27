import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.vsix'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
