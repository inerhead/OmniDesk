import { z } from 'zod';

/** Códigos de error con significado para el cliente (SPEC 07: identidad; SPEC 09: canales y firma). */
export const ApiErrorCodeSchema = z.enum([
  'UNAUTHENTICATED',
  'NO_ACTIVE_TENANT',
  'LAST_OWNER',
  'INVITATION_EXPIRED',
  'INVITATION_EMAIL_MISMATCH',
  'SLUG_TAKEN',
  'TENANT_CREATION_FORBIDDEN',
  'ALREADY_MEMBER',
  'INVALID_SIGNATURE',
  'INVALID_WEBHOOK_URL',
  'CHANNEL_EXTERNAL_ID_TAKEN',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

/** Cuerpo de los errores con código. */
export const ApiErrorSchema = z.object({
  statusCode: z.int(),
  code: ApiErrorCodeSchema,
  message: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
