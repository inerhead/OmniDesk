/** Clave nueva en cada subida: la caché `immutable` nunca sirve una foto vieja con la URL nueva. */
export function avatarStorageKey(userId: string, token: string): string {
  return `${avatarStoragePrefix(userId)}avatar-${token}`;
}

/** Todo lo de una cuenta en el bucket: se borra con la cuenta (SPEC 20). */
export function avatarStoragePrefix(userId: string): string {
  return `users/${userId}/`;
}
