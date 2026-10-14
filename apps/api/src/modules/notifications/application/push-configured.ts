import type { Env } from '../../../shared/config/env';

/** Las tres claves VAPID juntas: sin ellas no se encolan ni se envían avisos. */
export function pushConfigured(env: Env): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}
