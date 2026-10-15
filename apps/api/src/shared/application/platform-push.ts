import type { OutboxPort } from './outbox.port';

/** Tipo de Outbox del push de plataforma (SPEC 18). */
export const PLATFORM_PUSH_REQUESTED = 'platform.push_requested';

/**
 * Push a usuarios, no a miembros: la solicitud nueva a los admins, y la aprobación o el rechazo al
 * solicitante. Sale aunque la empresa del evento esté en revisión o ya se haya borrado, y no pasa por
 * las preferencias de miembro de SPEC 13. `url` es relativa a la app (sin `PUBLIC_BASE_PATH`).
 */
export interface PlatformPush {
  userIds: string[];
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** Encola el push en la transacción activa. Sin destinatarios, no encola nada. */
export async function enqueuePlatformPush(
  outbox: OutboxPort,
  tenantId: string,
  push: PlatformPush,
): Promise<void> {
  if (push.userIds.length === 0) return;
  await outbox.enqueue({ tenantId, type: PLATFORM_PUSH_REQUESTED, payload: push });
}
