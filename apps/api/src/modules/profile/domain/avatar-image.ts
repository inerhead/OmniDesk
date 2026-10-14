export type AvatarMimeType = 'image/jpeg' | 'image/webp';

/**
 * Tipo real por los primeros bytes, no por lo que declara el cliente. Solo JPEG y WebP: es lo que
 * exporta el recorte de la web.
 */
export function detectAvatarMimeType(bytes: Uint8Array): AvatarMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** Clave nueva en cada subida: la caché `immutable` nunca sirve una foto vieja con la URL nueva. */
export function avatarStorageKey(userId: string, token: string): string {
  return `users/${userId}/avatar-${token}`;
}
