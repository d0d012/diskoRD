import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // dist = Vite output, src-tauri = Rust crate + build artifacts (not JS source)
  globalIgnores(['dist', 'src-tauri']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Underscore-prefixed identifiers are intentionally unused (e.g. discarded
      // destructure targets).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // eslint-plugin-react-hooks v7's recommended set ships the react-compiler
      // analysis rules as errors. Keep them as warnings: they flag style/perf
      // patterns, not correctness, and predate this config. rules-of-hooks and
      // exhaustive-deps stay at their defaults.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      // Fast-refresh DX hint, not a correctness issue.
      'react-refresh/only-export-components': 'warn',
    },
  },
  {
    // Tests legitimately use `any` for mocks/fixtures.
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])
