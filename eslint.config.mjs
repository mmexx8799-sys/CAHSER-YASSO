// ESLint flat config — 2.4 (npm run lint).
// Gate philosophy: ERRORS = hygiene that must never regress (unused code,
// undefined globals, const-correctness). WARNINGS = known backlog tracks that
// must stay visible but must not block CI today:
//   - no-explicit-any / preserve-caught-error → services/api.ts hardening
//     is its own future task (AUDIT-SEC-1 validation unification).
//   - react-hooks/set-state-in-effect|immutability|static-components →
//     established page patterns; refactor only with behavior tests.
//   - no-restricted-imports on pages/ → documents AUDIT-ARCH-1 (service-layer
//     bypass). Error-level would demand the full services/ split now, which is
//     explicitly a post-P0 backlog track — warn keeps it visible per PR.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-ssr/**',
      'android/**',
      'node_modules/**',
      'vite.config.ts.timestamp-*.mjs',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      'preserve-caught-error': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/static-components': 'warn',
    },
  },
  // AUDIT-ARCH-1 guard (warn): pages/stores/components/contexts/hooks must go
  // through services/api.ts — only services/ and tests/ may touch
  // firebase/firestore directly (ReturnsPage:524-544 bypass must not recur).
  {
    files: [
      'pages/**/*.{ts,tsx}',
      'stores/**/*.{ts,tsx}',
      'components/**/*.{ts,tsx}',
      'contexts/**/*.{ts,tsx}',
      'hooks/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          name: 'firebase/firestore',
          message:
            'Use services/api.ts instead of importing firebase/firestore directly (AUDIT-ARCH-1).',
        },
      ],
    },
  },
  // Node scripts: console/process/setTimeout are provided by the runtime.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  // Tests: `any` casts are the norm for fixture shaping.
  {
    files: ['tests/**/*.ts', 'vitest.config.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
