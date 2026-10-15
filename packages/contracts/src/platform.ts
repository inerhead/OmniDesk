import { z } from 'zod';

/** Motivo de un rechazo o una suspensión (SPEC 18): lo ven el solicitante o los miembros. */
export const PlatformReasonSchema = z.string().trim().min(5).max(500);

/** `POST /api/v1/platform/tenants/:id/reject` y `/suspend`. */
export const PlatformReasonRequestSchema = z.object({ reason: PlatformReasonSchema });
export type PlatformReasonRequest = z.infer<typeof PlatformReasonRequestSchema>;

/** Pestaña de `/platform`. */
export const PlatformTenantStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export type PlatformTenantStatus = z.infer<typeof PlatformTenantStatusSchema>;

/** `GET /api/v1/platform/tenants?status=pending` */
export const PlatformTenantsQuerySchema = z.object({
  status: PlatformTenantStatusSchema.default('pending'),
});
export type PlatformTenantsQuery = z.infer<typeof PlatformTenantsQuerySchema>;

export const PlatformTenantRowSchema = z.object({
  /** id de la empresa; en `rejected`, el del rechazo. */
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  /** Quien pidió el alta; en `approved`, el Owner más antiguo. */
  requester: z.object({ displayName: z.string(), email: z.string() }),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  requestedAt: z.iso.datetime(),
  approvedAt: z.iso.datetime().nullable(),
  rejectedAt: z.iso.datetime().nullable(),
  rejectionReason: z.string().nullable(),
  /** Solo en `approved`. */
  state: z.enum(['active', 'inactive', 'suspended']).nullable(),
  suspensionReason: z.string().nullable(),
});
export type PlatformTenantRow = z.infer<typeof PlatformTenantRowSchema>;

/** Respuesta de `GET /api/v1/platform/tenants`. */
export const PlatformTenantsResponseSchema = z.array(PlatformTenantRowSchema);
export type PlatformTenantsResponse = z.infer<typeof PlatformTenantsResponseSchema>;
