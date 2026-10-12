import { z } from 'zod';

/** Códigos de error de identidad, empresas e invitaciones (SPEC 07). */
export const ApiErrorCodeSchema = z.enum([
  'UNAUTHENTICATED',
  'NO_ACTIVE_TENANT',
  'LAST_OWNER',
  'INVITATION_EXPIRED',
  'INVITATION_EMAIL_MISMATCH',
  'SLUG_TAKEN',
  'ALREADY_MEMBER',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

/** Cuerpo de los errores con código. */
export const ApiErrorSchema = z.object({
  statusCode: z.int(),
  code: ApiErrorCodeSchema,
  message: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
