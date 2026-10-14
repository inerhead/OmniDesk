import { MeResponseSchema, type MeResponse } from '@omnidesk/contracts';
import { ApiHttpError, deleteJson, putForm } from '@/shared/api/http-client';

type MeUser = MeResponse['user'];

/** Sube el recorte (512×512). `415` tipo no admitido, `413` más de 1 MB. */
export async function putAvatar(image: Blob): Promise<MeUser> {
  const form = new FormData();
  form.set('file', image, image.type === 'image/webp' ? 'avatar.webp' : 'avatar.jpg');
  const { status, body } = await putForm('/api/v1/me/avatar', form);
  if (status !== 200) throw new ApiHttpError(status);
  return MeResponseSchema.shape.user.parse(body);
}

/** Quita la foto subida: vuelve la de Google o las iniciales. */
export async function deleteAvatar(): Promise<MeUser> {
  const { status, body } = await deleteJson('/api/v1/me/avatar');
  if (status !== 200) throw new ApiHttpError(status);
  return MeResponseSchema.shape.user.parse(body);
}
