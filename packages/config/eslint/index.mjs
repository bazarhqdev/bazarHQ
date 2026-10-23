// Shared flat ESLint config for TypeScript + React packages (shared, ui, mobile).
// The Next.js app extends eslint-config-next instead and adds the same custom rules.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export const sharedRules = {
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  // A service-role key must never reach client code (SRS §5.2, MOB-11).
  'no-restricted-syntax': [
    'error',
    { selector: 'Literal[value=/service_role|SERVICE_ROLE/]', message: 'Service-role credentials must never appear in client code.' },
  ],
};

export function createConfig({ ignores = [] } = {}) {
  return tseslint.config(
    { ignores: ['**/node_modules/**', '**/dist/**', '**/android/**', ...ignores] },
    {
      files: ['**/*.{ts,tsx}'],
      extends: [js.configs.recommended, ...tseslint.configs.recommended],
      plugins: { 'react-hooks': reactHooks },
      languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.node } },
      rules: { ...reactHooks.configs.recommended.rules, ...sharedRules },
    },
  );
}

export default createConfig();
