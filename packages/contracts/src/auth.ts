import { z } from 'zod';
import { MemberRoleSchema } from './members';
import { AvatarUrlSchema } from './profile';

/** Cookie `httpOnly` con el token opaco de la sesión. */
export const SESSION_COOKIE = 'omnidesk_session';

export const MembershipSchema = z.object({
  memberId: z.uuid(),
  tenantId: z.uuid(),
  tenantName: z.string(),
  tenantSlug: z.string(),
  role: MemberRoleSchema,
  /** Logo de la empresa (SPEC 16); `null` = iniciales. */
  tenantLogoUrl: z.string().nullable().default(null),
  /** `false` solo lo ven los OWNER: la empresa está inactiva y solo se puede reactivar. */
  tenantActive: z.boolean().default(true),
});
export type Membership = z.infer<typeof MembershipSchema>;

/** `GET /api/v1/me` */
export const MeResponseSchema = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.email(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
  }),
  memberships: z.array(MembershipSchema),
  /** Empresa con la que trabaja la sesión; `null` sin membresías. */
  activeTenantId: z.uuid().nullable(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/** `POST /api/v1/me/active-tenant` */
export const SetActiveTenantRequestSchema = z.object({ tenantId: z.uuid() });
export type SetActiveTenantRequest = z.infer<typeof SetActiveTenantRequestSchema>;

/** `POST /api/v1/auth/dev-login` (solo `DEMO_MODE=true`). */
export const DevLoginRequestSchema = z.object({ memberId: z.uuid() });
export type DevLoginRequest = z.infer<typeof DevLoginRequestSchema>;

/** `GET /api/v1/auth/providers`: qué botones muestra la pantalla de login. */
export const AuthProvidersResponseSchema = z.object({
  google: z.boolean(),
  /** Miembros demo para "Entrar como…"; vacío sin `DEMO_MODE`. */
  demoMembers: z.array(
    z.object({
      memberId: z.uuid(),
      displayName: z.string(),
      role: MemberRoleSchema,
      avatarUrl: AvatarUrlSchema,
    }),
  ),
});
export type AuthProvidersResponse = z.infer<typeof AuthProvidersResponseSchema>;
