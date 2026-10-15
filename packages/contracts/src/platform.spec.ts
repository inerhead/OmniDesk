import { describe, expect, it } from 'vitest';
import {
  PlatformReasonRequestSchema,
  PlatformTenantRowSchema,
  PlatformTenantsQuerySchema,
} from './platform';

describe('PlatformReasonRequestSchema', () => {
  it('recorta el motivo y exige de 5 a 500 caracteres', () => {
    expect(PlatformReasonRequestSchema.parse({ reason: '  Datos falsos  ' })).toEqual({
      reason: 'Datos falsos',
    });
    expect(PlatformReasonRequestSchema.safeParse({ reason: ' abc ' }).success).toBe(false);
    expect(PlatformReasonRequestSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
    expect(PlatformReasonRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('PlatformTenantsQuerySchema', () => {
  it('por defecto lista las pendientes y rechaza otro estado', () => {
    expect(PlatformTenantsQuerySchema.parse({})).toEqual({ status: 'pending' });
    expect(PlatformTenantsQuerySchema.parse({ status: 'rejected' })).toEqual({
      status: 'rejected',
    });
    expect(PlatformTenantsQuerySchema.safeParse({ status: 'all' }).success).toBe(false);
  });
});

describe('PlatformTenantRowSchema', () => {
  it('acepta una solicitud pendiente', () => {
    expect(
      PlatformTenantRowSchema.safeParse({
        id: '0199c0de-0000-7000-8000-000000000001',
        name: 'Acme',
        slug: 'acme',
        requester: { displayName: 'Ana', email: 'ana@example.com' },
        contactPhone: '+573001234567',
        contactEmail: 'ana@example.com',
        requestedAt: '2026-10-15T10:00:00.000Z',
        approvedAt: null,
        rejectedAt: null,
        rejectionReason: null,
        state: null,
        suspensionReason: null,
      }).success,
    ).toBe(true);
  });
});
