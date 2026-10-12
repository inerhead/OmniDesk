import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Token de inyección para la versión del API. */
export const APP_VERSION = Symbol('APP_VERSION');

/** Versión de apps/api/package.json. Los scripts de pnpm se ejecutan con cwd = apps/api. */
export function readAppVersion(cwd: string = process.cwd()): string {
  const pkg = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8')) as {
    version?: string;
  };
  return pkg.version ?? '0.0.0';
}
