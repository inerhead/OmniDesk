import type { RealtimeEvent } from '@omnidesk/contracts';
import type { OutboxPort } from '../../../shared/application/outbox.port';

/** Encola `conversation.changed` (reason `message`) en la transacción activa. */
export function enqueueMessageChanged(
  outbox: OutboxPort,
  tenantId: string,
  conversationId: string,
  occurredAt: Date,
): Promise<void> {
  const payload: RealtimeEvent = {
    type: 'conversation.changed',
    conversationId,
    reason: 'message',
    occurredAt: occurredAt.toISOString(),
  };
  return outbox.enqueue({ tenantId, type: 'conversation.changed', payload });
}
