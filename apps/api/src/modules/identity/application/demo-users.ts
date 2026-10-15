import { DEMO_PLATFORM_ADMIN_EMAIL } from '../../../shared/application/platform-admins';

export type DemoUser = 'platform-admin' | 'new-user';

/**
 * Usuarios demo sin empresa (SPEC 18), para probar en local la revisión de empresas: el admin de
 * plataforma y alguien que acaba de llegar y pide su empresa. Solo con `DEMO_MODE=true`.
 */
export const DEMO_USERS: Readonly<Record<DemoUser, { email: string; displayName: string }>> = {
  'platform-admin': { email: DEMO_PLATFORM_ADMIN_EMAIL, displayName: 'Admin de plataforma' },
  'new-user': { email: 'new-user@demo.omnidesk.local', displayName: 'Usuario nuevo' },
};
