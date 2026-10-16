import { describe, expect, it } from 'vitest';
import { checkTenantDeletion, isOrphanAccount } from './tenant-purge';

describe('checkTenantDeletion', () => {
  const suspended = { slug: 'acme', state: 'suspended' as const };

  it('una empresa suspendida con el slug exacto se puede borrar', () => {
    expect(checkTenantDeletion(suspended, 'acme', false)).toBe('ok');
  });

  it('el slug debe coincidir exactamente, sin recortar espacios ni ignorar mayúsculas', () => {
    expect(checkTenantDeletion(suspended, ' acme', false)).toBe('confirmation-mismatch');
    expect(checkTenantDeletion(suspended, 'ACME', false)).toBe('confirmation-mismatch');
  });

  it.each(['active', 'inactive', 'pending'] as const)('una empresa %s no se borra', (state) => {
    expect(checkTenantDeletion({ slug: 'acme', state }, 'acme', false)).toBe('not-suspended');
  });

  it('ya en borrado responde igual, sin mirar la confirmación', () => {
    expect(checkTenantDeletion({ slug: 'acme', state: 'deleting' }, 'otra', false)).toBe(
      'already-deleting',
    );
  });

  it('la demo solo queda bloqueada con DEMO_MODE', () => {
    const demo = { slug: 'demo', state: 'suspended' as const };
    expect(checkTenantDeletion(demo, 'demo', true)).toBe('demo-locked');
    expect(checkTenantDeletion({ ...demo, state: 'active' }, 'demo', true)).toBe('demo-locked');
    expect(checkTenantDeletion(demo, 'demo', false)).toBe('ok');
  });
});

describe('isOrphanAccount', () => {
  const admins = (email: string) => email === 'admin@example.com';

  it('sin otra empresa activa, la cuenta se borra', () => {
    expect(
      isOrphanAccount(
        { userId: 'u1', email: 'ana@example.com', otherActiveMemberships: 0 },
        admins,
      ),
    ).toBe(true);
  });

  it('con otra empresa activa, se conserva', () => {
    expect(
      isOrphanAccount(
        { userId: 'u1', email: 'ana@example.com', otherActiveMemberships: 1 },
        admins,
      ),
    ).toBe(false);
  });

  it('un admin de plataforma nunca se borra', () => {
    expect(
      isOrphanAccount(
        { userId: 'u1', email: 'admin@example.com', otherActiveMemberships: 0 },
        admins,
      ),
    ).toBe(false);
  });
});
