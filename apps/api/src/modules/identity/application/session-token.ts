import { createHash, randomBytes } from 'node:crypto';

/** Token opaco de 32 bytes para la cookie o el enlace; nunca se guarda en claro. */
export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** sha256 hex: lo que se guarda en la base para buscar el token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
