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
  // SPEC 16: empresa inactiva, confirmación al inactivar y slug fijo de la demo.
  'TENANT_INACTIVE',
  'CONFIRMATION_MISMATCH',
  'DEMO_SLUG_LOCKED',
  // SPEC 18: revisión y suspensión por la plataforma.
  'TENANT_PENDING',
  'TENANT_SUSPENDED',
  'REQUEST_PENDING',
  'NOT_PENDING',
  'NOT_APPROVED',
  // SPEC 20: borrado de empresas por la plataforma.
  'NOT_SUSPENDED',
  'DEMO_TENANT_LOCKED',
  'TENANT_DELETING',
  // SPEC 22: credenciales de cliente de n8n.
  'N8N_CLIENT_SECRET_REQUIRED',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

/** Cuerpo de los errores con código. */
export const ApiErrorSchema = z.object({
  statusCode: z.int(),
  code: ApiErrorCodeSchema,
  message: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
