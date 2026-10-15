import type { Env } from '../config/env';

/** Usuario demo que se suma a los admins de plataforma con `DEMO_MODE=true` (SPEC 18). */
export const DEMO_PLATFORM_ADMIN_EMAIL = 'platform-admin@demo.omnidesk.local';

/**
 * Admins de plataforma (SPEC 18): los emails de `PLATFORM_ADMIN_EMAILS`, más el demo con
 * `DEMO_MODE=true`. No es un rol de empresa: se decide por el email del usuario de la sesión.
 */
export class PlatformAdmins {
  private readonly emails: ReadonlySet<string>;

  constructor(emails: Iterable<string>) {
    this.emails = new Set([...emails].map(normalizeEmail));
  }

  static fromEnv(env: Pick<Env, 'PLATFORM_ADMIN_EMAILS' | 'DEMO_MODE'>): PlatformAdmins {
    const emails = [...env.PLATFORM_ADMIN_EMAILS];
    if (env.DEMO_MODE) emails.push(DEMO_PLATFORM_ADMIN_EMAIL);
    return new PlatformAdmins(emails);
  }

  isPlatformAdmin(email: string): boolean {
    return this.emails.has(normalizeEmail(email));
  }

  /** Sin admins, nadie aprueba: las solicitudes se quedan en revisión. */
  get isEmpty(): boolean {
    return this.emails.size === 0;
  }

  /** Para encolar los avisos a los admins. */
  list(): string[] {
    return [...this.emails];
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const PLATFORM_ADMINS = Symbol('PLATFORM_ADMINS');
