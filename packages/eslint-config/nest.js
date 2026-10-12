import globals from 'globals';
import tseslint from 'typescript-eslint';
import base from './base.js';

const notRelative = {
  regex: '^[^.]',
  message: 'domain/ es TypeScript puro: solo importa su propio dominio y shared/kernel.',
};
const toApplication = {
  regex: '(^|/)application(/|$)',
  message: 'domain/ no puede depender de application/.',
};
const toInfrastructure = {
  regex: '(^|/)infrastructure(/|$)',
  message: 'Solo infrastructure/ puede depender de infrastructure/.',
};
const toPrisma = { regex: '^@prisma/', message: 'Prisma solo se usa desde infrastructure/.' };
const toNestNonCommon = {
  regex: '^@nestjs/(?!common$)',
  message: 'application/ solo puede usar @nestjs/common (decoradores de DI).',
};

/**
 * Configuración del API NestJS.
 * Hace cumplir los límites entre capas descritos en docs/arquitectura.md §6.
 */
export default tseslint.config(
  ...base,
  {
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['**/domain/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [notRelative, toApplication, toInfrastructure] },
      ],
    },
  },
  {
    files: ['**/application/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [toInfrastructure, toPrisma, toNestNonCommon] },
      ],
    },
  },
);
