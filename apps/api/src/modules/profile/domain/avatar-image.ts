/** Clave nueva en cada subida: la caché `immutable` nunca sirve una foto vieja con la URL nueva. */
export function avatarStorageKey(userId: string, token: string): string {
  return `users/${userId}/avatar-${token}`;
}
