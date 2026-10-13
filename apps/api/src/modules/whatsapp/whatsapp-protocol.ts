import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { E164Schema, MessageTextSchema } from '@omnidesk/contracts';
import type { InboundMessageInput } from '../conversations/application/register-inbound-message.use-case';
import type { DeliveryStatus } from '../conversations/domain/delivery';

export function verifyMetaSignature(
  raw: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(
    createHmac('sha256', secret).update(raw).digest(),
    Buffer.from(signature.slice(7), 'hex'),
  );
}

const Timestamp = z
  .string()
  .regex(/^\d+$/)
  .transform((v) => new Date(Number(v) * 1000))
  .refine((v) => Number.isFinite(v.getTime()));
const TextMessage = z.object({
  id: z.string().min(1).max(200),
  from: z
    .string()
    .transform((v) => (v.startsWith('+') ? v : `+${v}`))
    .pipe(E164Schema),
  timestamp: Timestamp,
  type: z.literal('text'),
  text: z.object({ body: MessageTextSchema }),
});
const Status = z.object({
  id: z.string().min(1),
  status: z.enum(['sent', 'delivered', 'read', 'failed']),
  timestamp: Timestamp,
  biz_opaque_callback_data: z.uuid().optional(),
});
const Envelope = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          value: z
            .object({
              metadata: z.object({ phone_number_id: z.string() }).optional(),
              contacts: z
                .array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string() }) }))
                .optional(),
              messages: z.array(z.unknown()).optional(),
              statuses: z.array(z.unknown()).optional(),
            })
            .passthrough(),
        }),
      ),
    }),
  ),
});
export type WhatsAppEvent =
  | ({ kind: 'inbound' } & InboundMessageInput)
  | {
      kind: 'status';
      providerMessageId: string;
      messageId?: string;
      status: DeliveryStatus;
      occurredAt: Date;
    };

export function parseWhatsAppEvents(body: unknown, externalId: string): WhatsAppEvent[] {
  const parsed = Envelope.safeParse(body);
  if (!parsed.success) return [];
  const events: WhatsAppEvent[] = [];
  for (const entry of parsed.data.entry)
    for (const { value } of entry.changes) {
      if (value.metadata?.phone_number_id !== externalId) continue;
      for (const raw of value.messages ?? []) {
        const message = TextMessage.safeParse(raw);
        if (!message.success) continue;
        const m = message.data;
        const contact = value.contacts?.find((c) => `+${c.wa_id}` === m.from);
        events.push({
          kind: 'inbound',
          externalMessageId: m.id,
          from: { externalId: m.from, ...(contact && { displayName: contact.profile.name }) },
          text: m.text.body,
          sentAt: m.timestamp,
        });
      }
      for (const raw of value.statuses ?? []) {
        const status = Status.safeParse(raw);
        if (!status.success) continue;
        const s = status.data;
        events.push({
          kind: 'status',
          providerMessageId: s.id,
          ...(s.biz_opaque_callback_data && { messageId: s.biz_opaque_callback_data }),
          status: s.status.toUpperCase() as DeliveryStatus,
          occurredAt: s.timestamp,
        });
      }
    }
  return events;
}
