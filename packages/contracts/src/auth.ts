import { z } from 'zod';
import { MemberRoleSchema } from './members';
import { AvatarUrlSchema } from './profile';
import { TenantStateSchema } from './tenants';

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
  /** Estado efectivo (SPEC 18). `tenantActive` es `true` solo con `active`. */
  tenantState: TenantStateSchema.default('active'),
  /** Motivo de la suspensión, visible para todos los miembros; `null` si no está suspendida. */
  suspensionReason: z.string().nullable().default(null),
  /** Cuándo se suspendió; `null` si no está suspendida. */
  suspendedAt: z.iso.datetime().nullable().default(null),
  /** Cuándo se pidió el alta; solo en una empresa en revisión, para la pantalla de espera. */
  requestedAt: z.iso.datetime().nullable().default(null),
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
  /** Admin de plataforma (SPEC 18): ve `/platform`. */
  isPlatformAdmin: z.boolean().default(false),
  /** Solicitudes de empresa pendientes; `null` si no es admin de plataforma. */
  platformPendingCount: z.number().int().nullable().default(null),
  /** Último rechazo sin cerrar de una solicitud de este usuario. */
  tenantRejection: z
    .object({ tenantName: z.string(), reason: z.string(), rejectedAt: z.iso.datetime() })
    .nullable()
    .default(null),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/** `POST /api/v1/me/active-tenant` */
export const SetActiveTenantRequestSchema = z.object({ tenantId: z.uuid() });
export type SetActiveTenantRequest = z.infer<typeof SetActiveTenantRequestSchema>;

/** Usuarios demo sin empresa (SPEC 18): el admin de plataforma y un usuario recién llegado. */
export const DemoUserSchema = z.enum(['platform-admin', 'new-user']);
export type DemoUser = z.infer<typeof DemoUserSchema>;

/** `POST /api/v1/auth/dev-login` (solo `DEMO_MODE=true`): un miembro demo o un usuario demo. */
export const DevLoginRequestSchema = z
  .object({ memberId: z.uuid().optional(), demoUser: DemoUserSchema.optional() })
  .refine((value) => (value.memberId === undefined) !== (value.demoUser === undefined), {
    message: 'Indica memberId o demoUser, solo uno',
  });
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
  /** Usuarios demo sin empresa (SPEC 18); vacío sin `DEMO_MODE`. */
  demoUsers: z.array(z.object({ demoUser: DemoUserSchema, displayName: z.string() })).default([]),
});
export type AuthProvidersResponse = z.infer<typeof AuthProvidersResponseSchema>;
