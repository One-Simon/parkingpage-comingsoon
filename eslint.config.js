import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        ResizeObserver: 'readonly',
        HTMLElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLFormElement: 'readonly',
        HTMLButtonElement: 'readonly',
        Element: 'readonly',
        Event: 'readonly',
        PointerEvent: 'readonly',
        DOMRect: 'readonly',
        AbortController: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        queueMicrotask: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
