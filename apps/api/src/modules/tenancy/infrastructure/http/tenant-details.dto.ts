import {
  TenantDetailsSchema,
  type TenantDetails as TenantDetailsResponse,
} from '@omnidesk/contracts';
import { createZodDto } from 'nestjs-zod';
import { DEMO_TENANT_SLUG, tenantLogoUrl, type TenantDetails } from '../../domain/tenant';

export class TenantDetailsDto extends createZodDto(TenantDetailsSchema) {}

export function toTenantDetailsDto(tenant: TenantDetails): TenantDetailsResponse {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    logoUrl: tenantLogoUrl(tenant),
    deactivatedAt: tenant.deactivatedAt?.toISOString() ?? null,
    deactivatedBy: tenant.deactivatedBy,
    slugLocked: tenant.slug === DEMO_TENANT_SLUG,
  };
}
