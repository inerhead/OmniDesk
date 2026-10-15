import { z } from 'zod';
import {
  IMAGE_SIZE_PX,
  IMAGE_SOURCE_MAX_BYTES,
  IMAGE_SOURCE_MIME_TYPES,
  IMAGE_UPLOAD_MAX_BYTES,
} from './images';

/** Lo que acepta `PUT /api/v1/me/avatar`: el recorte ya reducido en la web. */
export const AVATAR_UPLOAD_MAX_BYTES = IMAGE_UPLOAD_MAX_BYTES;
/** Lo que acepta la web antes de recortar. */
export const AVATAR_SOURCE_MAX_BYTES = IMAGE_SOURCE_MAX_BYTES;
/** Lado del cuadrado que sube la web. */
export const AVATAR_SIZE_PX = IMAGE_SIZE_PX;
/** Formatos que la web deja elegir para recortar. */
export const AVATAR_SOURCE_MIME_TYPES = IMAGE_SOURCE_MIME_TYPES;

/** Foto de un usuario en las respuestas: subida, de Google o `null` (iniciales). */
export const AvatarUrlSchema = z.string().nullable().default(null);

const AVATAR_PATH_PREFIX = '/api/v1/users/';

/** Foto subida, relativa a la base del API; `version` = `avatarUpdatedAt` en ms. */
export function userAvatarPath(userId: string, version: number): string {
  return `${AVATAR_PATH_PREFIX}${encodeURIComponent(userId)}/avatar?v=${version}`;
}

/** `true` si la URL es una foto subida (no la de Google). */
export function isUploadedAvatarUrl(url: string | null): boolean {
  return url !== null && url.startsWith(AVATAR_PATH_PREFIX);
}
