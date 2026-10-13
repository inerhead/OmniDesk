import { describe, expect, it } from 'vitest';
import { canCreateTenant } from './tenant-permissions';

const as = (...roles: Array<'OWNER' | 'ADMIN' | 'AGENT'>) => ({
  memberships: roles.map((role) => ({ role })),
});

describe('canCreateTenant', () => {
  it('sin empresas o siendo OWNER en alguna, sí', () => {
    expect(canCreateTenant(as())).toBe(true);
    expect(canCreateTenant(as('AGENT', 'OWNER'))).toBe(true);
  });

  it('solo AGENT o ADMIN, no', () => {
    expect(canCreateTenant(as('AGENT'))).toBe(false);
    expect(canCreateTenant(as('ADMIN', 'AGENT'))).toBe(false);
  });
});
