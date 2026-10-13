import js from '@eslint/js';
import globals from 'globals';
export default [
  { ignores: ['storage/**'] },
  { files: ['**/*.{js,mjs}'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    rules: { ...js.configs.recommended.rules, 'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] } },
];
