import type { RealtimeEvent } from '@omnidesk/contracts';
import type { OutboxPort } from '../../../shared/application/outbox.port';

/**
 * Encola `conversation.changed` en la transacción activa. `inbound` marca un mensaje del cliente
 * (SPEC 21): la web anima el icono de Conversaciones solo con esos.
 */
export function enqueueConversationChanged(
  outbox: OutboxPort,
  tenantId: string,
  conversationId: string,
  reason: RealtimeEvent['reason'],
  occurredAt: Date,
  options: { inbound?: true } = {},
): Promise<void> {
  const payload: RealtimeEvent = {
    type: 'conversation.changed',
    conversationId,
    reason,
    ...(options.inbound && { inbound: true }),
    occurredAt: occurredAt.toISOString(),
  };
  return outbox.enqueue({ tenantId, type: 'conversation.changed', payload });
}
