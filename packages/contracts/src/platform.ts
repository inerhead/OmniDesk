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

/** `POST /api/v1/platform/tenants/:id/delete` (SPEC 20): el slug exacto confirma el borrado. */
export const DeleteTenantRequestSchema = z.object({ confirmSlug: z.string() });
export type DeleteTenantRequest = z.infer<typeof DeleteTenantRequestSchema>;

/** `GET /api/v1/platform/tenants/:id/deletion-preview`: lo que se borraría. */
export const TenantDeletionPreviewSchema = z.object({
  members: z.number().int(),
  /** Cuentas que quedarían sin empresa y se borrarían. */
  accountsToDelete: z.number().int(),
  conversations: z.number().int(),
  messages: z.number().int(),
  attachments: z.number().int(),
});
export type TenantDeletionPreview = z.infer<typeof TenantDeletionPreviewSchema>;

/** Constancia de una empresa borrada o en borrado. */
export const PlatformTenantDeletionRowSchema = z.object({
  id: z.uuid(),
  tenantName: z.string(),
  tenantSlug: z.string(),
  requestedByEmail: z.string(),
  requestedAt: z.iso.datetime(),
  /** null = el borrado sigue en curso. */
  completedAt: z.iso.datetime().nullable(),
  membersDeleted: z.number().int(),
  usersDeleted: z.number().int(),
  conversationsDeleted: z.number().int(),
  messagesDeleted: z.number().int(),
  attachmentsDeleted: z.number().int(),
});
export type PlatformTenantDeletionRow = z.infer<typeof PlatformTenantDeletionRowSchema>;

/** Respuesta de `GET /api/v1/platform/tenant-deletions`, de la más reciente a la más antigua. */
export const PlatformTenantDeletionsResponseSchema = z.array(PlatformTenantDeletionRowSchema);
export type PlatformTenantDeletionsResponse = z.infer<typeof PlatformTenantDeletionsResponseSchema>;
