export type ImageMimeType = 'image/jpeg' | 'image/webp';

/**
 * Tipo real de una imagen subida (foto de perfil, logo de empresa) por sus primeros bytes, no por lo
 * que declara el cliente. Solo JPEG y WebP: es lo que exporta el recorte de la web.
 */
export function detectImageMimeType(bytes: Uint8Array): ImageMimeType | null {
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
