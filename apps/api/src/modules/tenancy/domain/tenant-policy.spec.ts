import { describe, expect, it } from 'vitest';
import {
  canCreateTenant,
  canManageTenant,
  confirmsTenantName,
  isSlugChangeLocked,
} from './tenant-policy';

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

describe('canManageTenant', () => {
  it('solo OWNER edita e inactiva la empresa', () => {
    expect(canManageTenant('OWNER')).toBe(true);
    expect(canManageTenant('ADMIN')).toBe(false);
    expect(canManageTenant('AGENT')).toBe(false);
  });
});

describe('isSlugChangeLocked', () => {
  it('la demo no cambia de slug', () => {
    expect(isSlugChangeLocked('demo', 'otra')).toBe(true);
  });

  it('la demo puede reenviar su mismo slug o no enviarlo', () => {
    expect(isSlugChangeLocked('demo', 'demo')).toBe(false);
    expect(isSlugChangeLocked('demo', undefined)).toBe(false);
  });

  it('las demás empresas sí cambian de slug', () => {
    expect(isSlugChangeLocked('acme', 'acme-2')).toBe(false);
  });
});

describe('confirmsTenantName', () => {
  it('exige el nombre exacto, sin contar los espacios de los bordes', () => {
    expect(confirmsTenantName('Acme Corp', 'Acme Corp')).toBe(true);
    expect(confirmsTenantName('Acme Corp', '  Acme Corp ')).toBe(true);
    expect(confirmsTenantName('Acme Corp', 'acme corp')).toBe(false);
    expect(confirmsTenantName('Acme Corp', '')).toBe(false);
  });
});
