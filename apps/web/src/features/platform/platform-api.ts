import {
  PlatformTenantsResponseSchema,
  type PlatformTenantRow,
  type PlatformTenantStatus,
} from '@omnidesk/contracts';
import { apiCodeError } from '@/shared/api/api-error';
import { getJson, postJson } from '@/shared/api/http-client';

export const PLATFORM_QUERY_KEY = ['platform-tenants'] as const;

/** Una pestaña de `/platform` (SPEC 18). `404` si quien pregunta no es admin de plataforma. */
export async function fetchPlatformTenants(
  status: PlatformTenantStatus,
): Promise<PlatformTenantRow[]> {
  const { status: code, body } = await getJson(`/api/v1/platform/tenants?status=${status}`);
  if (code !== 200) throw apiCodeError(code, body);
  return PlatformTenantsResponseSchema.parse(body);
}

async function action(tenantId: string, verb: string, body?: object): Promise<void> {
  const { status, body: response } = await postJson(
    `/api/v1/platform/tenants/${encodeURIComponent(tenantId)}/${verb}`,
    body,
  );
  if (status !== 200) throw apiCodeError(status, response);
}

/** `409 NOT_PENDING` si ya no está en revisión. */
export const approveTenant = (tenantId: string) => action(tenantId, 'approve');
/** Borra la empresa; el solicitante ve el motivo. `409 NOT_PENDING`. */
export const rejectTenant = (tenantId: string, reason: string) =>
  action(tenantId, 'reject', { reason });
/** `409 NOT_APPROVED` si no está aprobada. Repetirla no cambia nada. */
export const suspendTenant = (tenantId: string, reason: string) =>
  action(tenantId, 'suspend', { reason });
export const unsuspendTenant = (tenantId: string) => action(tenantId, 'unsuspend');
