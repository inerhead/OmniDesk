import type { MeResponse } from '@omnidesk/contracts';
import { describe, expect, it } from 'vitest';
import { inactiveTenantRedirect } from './inactive-tenant';

const me = (tenantActive: boolean): MeResponse => ({
  user: { id: 'u1', email: 'a@b.co', displayName: 'Ana', avatarUrl: null },
  memberships: [
    {
      memberId: 'm1',
      tenantId: 't1',
      tenantName: 'Acme',
      tenantSlug: 'acme',
      role: 'OWNER',
      tenantLogoUrl: null,
      tenantActive,
      tenantState: tenantActive ? 'active' : 'inactive',
      suspensionReason: null,
      suspendedAt: null,
      requestedAt: null,
    },
  ],
  activeTenantId: 't1',
  isPlatformAdmin: false,
  platformPendingCount: null,
  tenantRejection: null,
});

describe('inactiveTenantRedirect', () => {
  it('con la empresa inactiva lleva cualquier ruta a /settings/company', () => {
    expect(inactiveTenantRedirect(me(false), '/conversations')).toBe('/settings/company');
    expect(inactiveTenantRedirect(me(false), '/settings/members')).toBe('/settings/company');
  });

  it('no redirige estando ya en /settings/company ni con la empresa activa', () => {
    expect(inactiveTenantRedirect(me(false), '/settings/company')).toBeNull();
    expect(inactiveTenantRedirect(me(true), '/conversations')).toBeNull();
    expect(inactiveTenantRedirect(undefined, '/conversations')).toBeNull();
  });
});
