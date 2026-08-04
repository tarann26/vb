import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  // I-B: `playwright.config.ts` and `e2e/**` run under Node (Playwright's
  // own test runner), never a browser -- `process.env`, `node:fs`'s
  // `readFileSync`, `node:path`'s `join`, none of which `globals.browser`
  // above declares. The rest of this repo's own tsconfig split (vite.config.ts
  // + plugins under tsconfig.node.json, worker/ under tsconfig.worker.json)
  // draws the identical Node-vs-browser line for the same reason; this is
  // that same split's ESLint-side equivalent for the one new Node-only
  // surface this task adds.
  {
    files: ['playwright.config.ts', 'e2e/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  }
);
