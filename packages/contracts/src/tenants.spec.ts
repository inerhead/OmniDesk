import { describe, expect, it } from 'vitest';
import {
  invitationLogoPath,
  RetentionPreviewQuerySchema,
  tenantLogoPath,
  TenantDetailsSchema,
  UpdateTenantRequestSchema,
} from './tenants';

describe('UpdateTenantRequestSchema', () => {
  it('acepta solo el nombre, solo el slug o ambos', () => {
    expect(UpdateTenantRequestSchema.safeParse({ name: 'Acme' }).success).toBe(true);
    expect(UpdateTenantRequestSchema.safeParse({ slug: 'acme-2' }).success).toBe(true);
    expect(UpdateTenantRequestSchema.safeParse({ name: 'Acme', slug: 'acme' }).success).toBe(true);
  });

  it('acepta solo la retención, incluido null (indefinidamente)', () => {
    expect(UpdateTenantRequestSchema.safeParse({ retentionDays: 90 }).success).toBe(true);
    expect(UpdateTenantRequestSchema.safeParse({ retentionDays: null }).success).toBe(true);
  });

  it('rechaza una retención fuera de 90, 180 y 365', () => {
    expect(UpdateTenantRequestSchema.safeParse({ retentionDays: 1 }).success).toBe(false);
    expect(UpdateTenantRequestSchema.safeParse({ retentionDays: '90' }).success).toBe(false);
  });

  it('rechaza un cuerpo vacío, un nombre corto y un slug inválido', () => {
    expect(UpdateTenantRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateTenantRequestSchema.safeParse({ name: ' A ' }).success).toBe(false);
    expect(UpdateTenantRequestSchema.safeParse({ slug: 'Con Espacios' }).success).toBe(false);
  });
});

describe('TenantDetailsSchema', () => {
  it('acepta una empresa activa sin logo', () => {
    expect(
      TenantDetailsSchema.safeParse({
        id: '0199c0de-0000-7000-8000-000000000001',
        name: 'Acme',
        slug: 'acme',
        logoUrl: null,
        deactivatedAt: null,
        deactivatedBy: null,
        slugLocked: false,
        retentionDays: null,
        contactPhone: null,
        contactEmail: null,
      }).success,
    ).toBe(true);
  });
});

describe('rutas del logo', () => {
  it('versiona la ruta por id y por token', () => {
    expect(tenantLogoPath('t1', 5)).toBe('/api/v1/tenants/t1/logo?v=5');
    expect(invitationLogoPath('abc', 5)).toBe('/api/v1/invitations/abc/logo?v=5');
  });
});

describe('RetentionPreviewQuerySchema', () => {
  it('convierte los días de la query y solo acepta 90, 180 o 365', () => {
    expect(RetentionPreviewQuerySchema.parse({ days: '180' })).toEqual({ days: 180 });
    expect(RetentionPreviewQuerySchema.safeParse({ days: '30' }).success).toBe(false);
    expect(RetentionPreviewQuerySchema.safeParse({}).success).toBe(false);
  });
});
