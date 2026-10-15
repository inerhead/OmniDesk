import { z } from 'zod';
import { MemberRefSchema } from './conversations';

/** Un OWNER no se invita: se crea la empresa o se cambia el rol. */
export const InvitableRoleSchema = z.enum(['ADMIN', 'AGENT']);
export type InvitableRole = z.infer<typeof InvitableRoleSchema>;

/** `POST /api/v1/invitations` */
export const CreateInvitationRequestSchema = z.object({
  email: z.email(),
  role: InvitableRoleSchema,
});
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequestSchema>;

export const CreateInvitationResponseSchema = z.object({
  id: z.uuid(),
  /** Enlace de un solo uso para compartir; el token solo aparece aquí. */
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export type CreateInvitationResponse = z.infer<typeof CreateInvitationResponseSchema>;

/** Invitación pendiente (`GET /api/v1/invitations`). */
export const InvitationSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: InvitableRoleSchema,
  invitedBy: MemberRefSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type Invitation = z.infer<typeof InvitationSchema>;

export const ListInvitationsResponseSchema = z.object({ items: z.array(InvitationSchema) });
export type ListInvitationsResponse = z.infer<typeof ListInvitationsResponseSchema>;

/** `GET /api/v1/invitations/by-token/:token`: vista previa pública. */
export const InvitationPreviewSchema = z.object({
  tenantName: z.string(),
  role: InvitableRoleSchema,
  /** "la***@ejemplo.com" */
  emailMasked: z.string(),
  /** Vencida, ya usada o revocada. */
  expired: z.boolean(),
  /** Logo de la empresa, servido por el token (SPEC 16); `null` = iniciales. */
  tenantLogoUrl: z.string().nullable().default(null),
});
export type InvitationPreview = z.infer<typeof InvitationPreviewSchema>;
