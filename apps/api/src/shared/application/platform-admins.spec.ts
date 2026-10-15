import { describe, expect, it } from 'vitest';
import { DEMO_PLATFORM_ADMIN_EMAIL, PlatformAdmins } from './platform-admins';

describe('PlatformAdmins', () => {
  it('compara sin distinguir mayúsculas ni espacios', () => {
    const admins = new PlatformAdmins(['Ana@Example.com']);

    expect(admins.isPlatformAdmin(' ana@example.COM ')).toBe(true);
    expect(admins.isPlatformAdmin('otra@example.com')).toBe(false);
  });

  it('suma el admin demo solo con DEMO_MODE', () => {
    const conDemo = PlatformAdmins.fromEnv({ PLATFORM_ADMIN_EMAILS: [], DEMO_MODE: true });
    const sinDemo = PlatformAdmins.fromEnv({ PLATFORM_ADMIN_EMAILS: [], DEMO_MODE: false });

    expect(conDemo.isPlatformAdmin(DEMO_PLATFORM_ADMIN_EMAIL)).toBe(true);
    expect(sinDemo.isPlatformAdmin(DEMO_PLATFORM_ADMIN_EMAIL)).toBe(false);
    expect(sinDemo.isEmpty).toBe(true);
  });

  it('lista los admins sin duplicados', () => {
    const admins = PlatformAdmins.fromEnv({
      PLATFORM_ADMIN_EMAILS: ['a@example.com', 'A@example.com'],
      DEMO_MODE: false,
    });

    expect(admins.list()).toEqual(['a@example.com']);
    expect(admins.isEmpty).toBe(false);
  });
});
