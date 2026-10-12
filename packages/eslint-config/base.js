import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Configuración común a todos los paquetes TypeScript del monorepo. */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/dev-dist/**', '**/coverage/**', '**/generated/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
