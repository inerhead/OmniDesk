/**
 * Imágenes subidas desde la web con recorte (foto de perfil de SPEC 15, logo de empresa de SPEC 16):
 * la web recorta, reduce y sube un cuadrado WebP o JPEG.
 */

/** Lo que acepta el API: el recorte ya reducido en la web. */
export const IMAGE_UPLOAD_MAX_BYTES = 1024 * 1024;
/** Lo que acepta la web antes de recortar. */
export const IMAGE_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
/** Lado del cuadrado que sube la web. */
export const IMAGE_SIZE_PX = 512;
/** Formatos que la web deja elegir para recortar. */
export const IMAGE_SOURCE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
