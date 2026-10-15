import {
  RetentionPreviewResponseSchema,
  TenantDetailsSchema,
  type RetentionDays,
  type TenantDetails,
  type UpdateTenantRequest,
} from '@omnidesk/contracts';
import { apiCodeError } from '@/shared/api/api-error';
import { deleteJson, getJson, patchJson, postJson, putForm } from '@/shared/api/http-client';

export const COMPANY_QUERY_KEY = ['tenant-current'] as const;
export const RETENTION_PREVIEW_QUERY_KEY = ['retention-preview'] as const;

async function parsed(request: Promise<{ status: number; body: unknown }>): Promise<TenantDetails> {
  const { status, body } = await request;
  if (status !== 200) throw apiCodeError(status, body);
  return TenantDetailsSchema.parse(body);
}

/** Empresa activa (solo OWNER). */
export function fetchCompany(): Promise<TenantDetails> {
  return parsed(getJson('/api/v1/tenants/current'));
}

/** `409 SLUG_TAKEN` o `409 DEMO_SLUG_LOCKED`. */
export function patchCompany(input: UpdateTenantRequest): Promise<TenantDetails> {
  return parsed(patchJson('/api/v1/tenants/current', input));
}

/** Sube el recorte del logo (512×512). `415` tipo no admitido, `413` más de 1 MB. */
export function putCompanyLogo(image: Blob): Promise<TenantDetails> {
  const form = new FormData();
  form.set('file', image, image.type === 'image/webp' ? 'logo.webp' : 'logo.jpg');
  return parsed(putForm('/api/v1/tenants/current/logo', form));
}

export function deleteCompanyLogo(): Promise<TenantDetails> {
  return parsed(deleteJson('/api/v1/tenants/current/logo'));
}

/** `400 CONFIRMATION_MISMATCH` si el nombre no coincide. */
export function deactivateCompany(confirmName: string): Promise<TenantDetails> {
  return parsed(postJson('/api/v1/tenants/current/deactivate', { confirmName }));
}

export function reactivateCompany(): Promise<TenantDetails> {
  return parsed(postJson('/api/v1/tenants/current/reactivate', {}));
}

/** Conversaciones cerradas que la próxima ejecución borraría con esos días (solo OWNER). */
export async function fetchRetentionPreview(days: Exclude<RetentionDays, null>): Promise<number> {
  const { status, body } = await getJson(`/api/v1/tenants/current/retention-preview?days=${days}`);
  if (status !== 200) throw apiCodeError(status, body);
  return RetentionPreviewResponseSchema.parse(body).conversations;
}
