import { z } from 'zod';
import { MemberRefSchema } from './conversations';

export const TenantSlugSchema = z
  .string()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9](-?[a-z0-9])*$/, 'Solo minúsculas, números y guiones simples');

/** `POST /api/v1/tenants`: quien la crea queda como OWNER y la empresa pasa a ser la activa. */
export const CreateTenantRequestSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: TenantSlugSchema,
});
export type CreateTenantRequest = z.infer<typeof CreateTenantRequestSchema>;

export const TenantSchema = z.object({ id: z.uuid(), name: z.string(), slug: z.string() });
export type Tenant = z.infer<typeof TenantSchema>;

/** Días que se conservan las conversaciones cerradas (SPEC 12); `null` = indefinidamente. */
export const RetentionDaysSchema = z.union([
  z.null(),
  z.literal(90),
  z.literal(180),
  z.literal(365),
]);
export type RetentionDays = z.infer<typeof RetentionDaysSchema>;

/** `PATCH /api/v1/tenants/current` (solo OWNER): al menos un campo. */
export const UpdateTenantRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    slug: TenantSlugSchema,
    retentionDays: RetentionDaysSchema,
  })
  .partial()
  .refine(
    (value) =>
      value.name !== undefined || value.slug !== undefined || value.retentionDays !== undefined,
    { message: 'Indica el nombre, el slug o la retención' },
  );
export type UpdateTenantRequest = z.infer<typeof UpdateTenantRequestSchema>;

/** `GET /api/v1/tenants/current` (solo OWNER). */
export const TenantDetailsSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  logoUrl: z.string().nullable(),
  /** `null` = activa. */
  deactivatedAt: z.iso.datetime().nullable(),
  deactivatedBy: MemberRefSchema.nullable(),
  /** La demo no cambia de slug: el login de desarrollo la busca por `demo`. */
  slugLocked: z.boolean(),
  retentionDays: RetentionDaysSchema,
});
export type TenantDetails = z.infer<typeof TenantDetailsSchema>;

/** `GET /api/v1/tenants/current/retention-preview?days=90` (solo OWNER). */
export const RetentionPreviewQuerySchema = z.object({
  days: z.coerce.number().pipe(z.union([z.literal(90), z.literal(180), z.literal(365)])),
});
export type RetentionPreviewQuery = z.infer<typeof RetentionPreviewQuerySchema>;

/** Conversaciones cerradas que la próxima ejecución del job borraría con esos días. */
export const RetentionPreviewResponseSchema = z.object({ conversations: z.int().min(0) });
export type RetentionPreviewResponse = z.infer<typeof RetentionPreviewResponseSchema>;

/** `POST /api/v1/tenants/current/deactivate`: el nombre exacto de la empresa, como confirmación. */
export const DeactivateTenantRequestSchema = z.object({ confirmName: z.string() });
export type DeactivateTenantRequest = z.infer<typeof DeactivateTenantRequestSchema>;

/** `failureReason` de los envíos cortados por una empresa inactiva. */
export const TENANT_INACTIVE_REASON = 'TENANT_INACTIVE';

/** Logo de una empresa, relativo a la base del API; `version` = `logoUpdatedAt` en ms. */
export function tenantLogoPath(tenantId: string, version: number): string {
  return `/api/v1/tenants/${encodeURIComponent(tenantId)}/logo?v=${version}`;
}

/** Logo visto desde una invitación vigente (sin sesión). */
export function invitationLogoPath(token: string, version: number): string {
  return `/api/v1/invitations/${encodeURIComponent(token)}/logo?v=${version}`;
}
