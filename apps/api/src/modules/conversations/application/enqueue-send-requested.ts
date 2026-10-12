import { z } from 'zod';
import type { OutboxPort } from '../../../shared/application/outbox.port';

export const MESSAGE_SEND_REQUESTED = 'message.send_requested';

export const SendRequestedPayloadSchema = z.object({ messageId: z.uuid() });
export type SendRequestedPayload = z.infer<typeof SendRequestedPayloadSchema>;

/** Encola el envío de un mensaje saliente al proveedor, en la transacción activa. */
export function enqueueSendRequested(
  outbox: OutboxPort,
  tenantId: string,
  messageId: string,
): Promise<void> {
  const payload: SendRequestedPayload = { messageId };
  return outbox.enqueue({ tenantId, type: MESSAGE_SEND_REQUESTED, payload });
}
