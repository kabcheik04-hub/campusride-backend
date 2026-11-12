import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['data/', 'node_modules/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: 'error',
    },
  },
];
