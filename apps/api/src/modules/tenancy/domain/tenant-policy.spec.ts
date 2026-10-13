import { describe, expect, it } from 'vitest';
import { canCreateTenant } from './tenant-policy';

describe('canCreateTenant', () => {
  it('quien aún no tiene empresa puede crear la primera', () => {
    expect(canCreateTenant([])).toBe(true);
  });

  it('quien es OWNER en alguna empresa puede crear otra', () => {
    expect(canCreateTenant(['OWNER'])).toBe(true);
    expect(canCreateTenant(['AGENT', 'OWNER'])).toBe(true);
  });

  it('quien solo es AGENT o ADMIN en empresas ajenas no puede', () => {
    expect(canCreateTenant(['AGENT'])).toBe(false);
    expect(canCreateTenant(['ADMIN'])).toBe(false);
    expect(canCreateTenant(['ADMIN', 'AGENT'])).toBe(false);
  });
});
