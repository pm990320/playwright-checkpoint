import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Apply the recommended JS rules first
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'commitlint.config.cjs'],
  },
  js.configs.recommended,
  // Apply TypeScript rules on top
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      // Minimal rules — add only as needed
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
);
