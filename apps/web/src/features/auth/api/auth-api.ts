import {
  AuthProvidersResponseSchema,
  ListMembersResponseSchema,
  MeResponseSchema,
  TenantSchema,
  type AuthProvidersResponse,
  type CreateTenantRequest,
  type DevLoginRequest,
  type ListMembersResponse,
  type MeResponse,
  type Tenant,
} from '@omnidesk/contracts';
import { apiCodeError } from '@/shared/api/api-error';
import { ApiHttpError, getJson, postJson, type RequestOptions } from '@/shared/api/http-client';

/** Usuario de la sesión. Lanza `ApiHttpError(401)` sin sesión. */
export async function fetchMe(options: RequestOptions = {}): Promise<MeResponse> {
  const { status, body } = await getJson('/api/v1/me', options);
  if (status !== 200) throw new ApiHttpError(status);
  return MeResponseSchema.parse(body);
}

export async function fetchAuthProviders(): Promise<AuthProvidersResponse> {
  const { status, body } = await getJson('/api/v1/auth/providers');
  if (status !== 200) throw new ApiHttpError(status);
  return AuthProvidersResponseSchema.parse(body);
}

/** Login de desarrollo (`DEMO_MODE`): un miembro o un usuario demo. El API deja la cookie de sesión. */
export async function postDevLogin(request: DevLoginRequest): Promise<MeResponse> {
  const { status, body } = await postJson('/api/v1/auth/dev-login', request);
  if (status !== 200) throw new ApiHttpError(status);
  return MeResponseSchema.parse(body);
}

export async function postLogout(): Promise<void> {
  const { status } = await postJson('/api/v1/auth/logout', undefined, { allowUnauthorized: true });
  if (status !== 204) throw new ApiHttpError(status);
}

export async function postActiveTenant(tenantId: string): Promise<MeResponse> {
  const { status, body } = await postJson('/api/v1/me/active-tenant', { tenantId });
  if (status !== 200) throw new ApiHttpError(status);
  return MeResponseSchema.parse(body);
}

/**
 * Pide el alta de una empresa: queda en revisión salvo para un admin de plataforma (SPEC 18). Lanza
 * `ApiCodeError` con `SLUG_TAKEN` si el slug ya existe o `REQUEST_PENDING` si ya hay una en revisión.
 */
export async function postTenant(input: CreateTenantRequest): Promise<Tenant> {
  const { status, body } = await postJson('/api/v1/tenants', input);
  if (status !== 201) throw apiCodeError(status, body);
  return TenantSchema.parse(body);
}

/** Cierra el aviso de una solicitud de empresa rechazada (SPEC 18). */
export async function postDismissTenantRejection(): Promise<void> {
  const { status } = await postJson('/api/v1/me/tenant-rejection/dismiss', undefined);
  if (status !== 204) throw new ApiHttpError(status);
}

/** Miembros activos de la empresa activa. */
export async function fetchMembers(): Promise<ListMembersResponse> {
  const { status, body } = await getJson('/api/v1/members');
  if (status !== 200) throw new ApiHttpError(status);
  return ListMembersResponseSchema.parse(body);
}

/** URL de página completa para entrar con Google (sin popups: también en la PWA de iOS). */
export function googleLoginUrl(apiBase: string, next: string): string {
  return `${apiBase}/api/v1/auth/google?${new URLSearchParams({ next })}`;
}
