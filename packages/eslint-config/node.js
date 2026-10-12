import globals from 'globals';
import tseslint from 'typescript-eslint';
import base from './base.js';

/** Scripts y herramientas que corren en Node (p. ej. tools/simulator). */
export default tseslint.config(...base, {
  languageOptions: { globals: { ...globals.node } },
});
