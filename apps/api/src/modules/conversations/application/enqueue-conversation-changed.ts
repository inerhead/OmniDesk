import type { RealtimeEvent } from '@omnidesk/contracts';
import type { OutboxPort } from '../../../shared/application/outbox.port';

/** Encola `conversation.changed` en la transacción activa. */
export function enqueueConversationChanged(
  outbox: OutboxPort,
  tenantId: string,
  conversationId: string,
  reason: RealtimeEvent['reason'],
  occurredAt: Date,
): Promise<void> {
  const payload: RealtimeEvent = {
    type: 'conversation.changed',
    conversationId,
    reason,
    occurredAt: occurredAt.toISOString(),
  };
  return outbox.enqueue({ tenantId, type: 'conversation.changed', payload });
}
