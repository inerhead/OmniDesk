import type { Membership, MeResponse } from '@omnidesk/contracts';
import { describe, expect, it } from 'vitest';
import {
  blockedActiveMembership,
  hasPendingRequest,
  showsRejectionNotice,
  tenantStateLabel,
  waitsInOnboarding,
} from './tenant-request';

function membership(tenantId: string, tenantState: Membership['tenantState']): Membership {
  return {
    memberId: `m-${tenantId}`,
    tenantId,
    tenantName: tenantId,
    tenantSlug: tenantId,
    role: 'OWNER',
    tenantLogoUrl: null,
    tenantActive: tenantState === 'active',
    tenantState,
    suspensionReason: null,
    suspendedAt: null,
    requestedAt: null,
  };
}

function me(memberships: Membership[], activeTenantId: string | null): MeResponse {
  return {
    user: { id: 'u1', email: 'ana@example.com', displayName: 'Ana', avatarUrl: null },
    memberships,
    activeTenantId,
    isPlatformAdmin: false,
    platformPendingCount: null,
    tenantRejection: null,
  };
}

describe('solicitudes de empresa (SPEC 18)', () => {
  it('una empresa en revisión de la que es OWNER es una solicitud pendiente', () => {
    expect(hasPendingRequest(me([membership('p', 'pending')], 'p'))).toBe(true);
    expect(hasPendingRequest(me([membership('a', 'active')], 'a'))).toBe(false);
  });

  it('bloquea la app con la empresa activa en revisión o suspendida, no con inactiva', () => {
    expect(blockedActiveMembership(me([membership('p', 'pending')], 'p'))?.tenantId).toBe('p');
    expect(blockedActiveMembership(me([membership('s', 'suspended')], 's'))?.tenantId).toBe('s');
    expect(blockedActiveMembership(me([membership('i', 'inactive')], 'i'))).toBeNull();
    expect(blockedActiveMembership(me([membership('a', 'active')], 'a'))).toBeNull();
  });

  it('la espera va en /onboarding solo si no tiene otras empresas', () => {
    expect(waitsInOnboarding(me([membership('p', 'pending')], 'p'))).toBe(true);
    expect(
      waitsInOnboarding(me([membership('a', 'active'), membership('p', 'pending')], 'p')),
    ).toBe(false);
  });

  it('el aviso de rechazo dentro de la app es solo con otras empresas', () => {
    const rejection = { tenantName: 'Acme', reason: 'Datos', rejectedAt: '2026-10-15T10:00:00Z' };
    expect(showsRejectionNotice({ ...me([], null), tenantRejection: rejection })).toBe(false);
    expect(
      showsRejectionNotice({ ...me([membership('a', 'active')], 'a'), tenantRejection: rejection }),
    ).toBe(true);
  });

  it('etiqueta los estados del selector', () => {
    expect(tenantStateLabel('pending')).toBe('En revisión');
    expect(tenantStateLabel('suspended')).toBe('Suspendida');
    expect(tenantStateLabel('inactive')).toBe('Inactiva');
    expect(tenantStateLabel('active')).toBeNull();
  });
});
