import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { E164Schema, MessageTextSchema, type AttachmentKind } from '@omnidesk/contracts';
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
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .pipe(
    z
      .string()
      .regex(/^\d+$/)
      .transform((value) => new Date(Number(value) * 1000))
      .refine((value) => Number.isFinite(value.getTime())),
  );
const PhoneNumberId = z.union([z.string(), z.number()]).transform((value) => String(value));
const From = z
  .string()
  .transform((v) => (v.startsWith('+') ? v : `+${v}`))
  .pipe(E164Schema);
const BaseMessage = z.object({
  id: z.string().min(1).max(200),
  from: From,
  timestamp: Timestamp,
  type: z.string().min(1).max(50),
});
const TextBody = z.object({ body: MessageTextSchema });
const Media = z.object({
  id: z.string().min(1),
  mime_type: z.string().min(1).max(255),
  sha256: z.string().optional(),
  caption: z.string().max(4096).optional(),
  filename: z.string().max(255).optional(),
  voice: z.boolean().optional(),
});
const MEDIA_KINDS = {
  image: 'IMAGE',
  document: 'DOCUMENT',
  audio: 'AUDIO',
  video: 'VIDEO',
  sticker: 'STICKER',
} as const satisfies Record<string, AttachmentKind>;
type MediaType = keyof typeof MEDIA_KINDS;
const Status = z.object({
  id: z.string().min(1),
  status: z
    .string()
    .transform((value) => value.toLowerCase())
    .pipe(z.enum(['sent', 'delivered', 'read', 'failed'])),
  timestamp: Timestamp,
  /** Si no es un uuid, se ignora y el estado se correlaciona por el id de Meta. */
  biz_opaque_callback_data: z.string().optional(),
});
const Envelope = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          field: z.string().optional(),
          value: z.record(z.string(), z.unknown()),
        }),
      ),
    }),
  ),
});
export type WhatsAppEvent =
  | ({ kind: 'inbound'; unsupportedType?: string } & InboundMessageInput)
  | {
      kind: 'status';
      providerMessageId: string;
      messageId?: string;
      status: DeliveryStatus;
      occurredAt: Date;
    };

type ParsedInbound = Omit<InboundMessageInput, 'from'> & { from: string; unsupportedType?: string };

/** `null` = no es un mensaje nuevo del cliente (reacción) o el sobre es inválido. */
function parseInboundMessage(raw: unknown): ParsedInbound | null {
  const base = BaseMessage.safeParse(raw);
  if (!base.success) return null;
  const { id, from, timestamp, type } = base.data;
  const common = { externalMessageId: id, from, sentAt: timestamp };
  const record = raw as Record<string, unknown>;
  if (type === 'text') {
    const text = TextBody.safeParse(record.text);
    return text.success ? { ...common, text: text.data.body } : null;
  }
  if (type === 'reaction') return null;
  if (Object.hasOwn(MEDIA_KINDS, type)) {
    const media = Media.safeParse(record[type]);
    if (media.success) {
      const m = media.data;
      return {
        ...common,
        text: m.caption ?? '',
        attachment: {
          kind: MEDIA_KINDS[type as MediaType],
          mimeType: m.mime_type,
          providerMediaId: m.id,
          ...(m.sha256 !== undefined && { sha256: m.sha256 }),
          ...(m.filename !== undefined && { fileName: m.filename }),
          ...(m.voice === true && { voice: true }),
        },
      };
    }
  }
  return { ...common, text: `[Mensaje de WhatsApp no soportado: ${type}]`, unsupportedType: type };
}

export function parseWhatsAppEvents(body: unknown, externalId: string): WhatsAppEvent[] {
  const parsed = Envelope.safeParse(body);
  if (!parsed.success) return [];
  const events: WhatsAppEvent[] = [];
  for (const entry of parsed.data.entry)
    for (const { value } of entry.changes) {
      const phoneId = z.object({ phone_number_id: PhoneNumberId }).safeParse(value.metadata);
      if (phoneId.success && phoneId.data.phone_number_id !== externalId) continue;
      const contacts = z
        .array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string() }).optional() }))
        .safeParse(value.contacts);
      for (const raw of asList(value.messages)) {
        const message = parseInboundMessage(raw);
        if (!message) continue;
        const contact = contacts.success
          ? contacts.data.find((item) => `+${item.wa_id}` === message.from)
          : undefined;
        events.push({
          kind: 'inbound',
          ...message,
          from: {
            externalId: message.from,
            ...(contact?.profile && { displayName: contact.profile.name }),
          },
        });
      }
      for (const raw of asList(value.statuses)) {
        const status = Status.safeParse(raw);
        if (!status.success) continue;
        const s = status.data;
        const callback = z.uuid().safeParse(s.biz_opaque_callback_data);
        events.push({
          kind: 'status',
          providerMessageId: s.id,
          ...(callback.success && { messageId: callback.data }),
          status: s.status.toUpperCase() as DeliveryStatus,
          occurredAt: s.timestamp,
        });
      }
    }
  return events;
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [value];
  return [];
}

/** Forma del webhook, sin teléfonos ni texto, para ver por qué no salió ningún estado. */
export function describeWhatsAppWebhook(body: unknown): string {
  if (!body || typeof body !== 'object') return 'sin objeto';
  const root = body as { object?: unknown; entry?: unknown };
  const entry = Array.isArray(root.entry) ? root.entry[0] : undefined;
  const change =
    entry && typeof entry === 'object' && Array.isArray((entry as { changes?: unknown }).changes)
      ? (entry as { changes: unknown[] }).changes[0]
      : undefined;
  const value =
    change && typeof change === 'object'
      ? (change as { field?: unknown; value?: unknown }).value
      : undefined;
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const status = asList(record.statuses)[0];
  const types =
    status && typeof status === 'object'
      ? Object.entries(status as Record<string, unknown>)
          .map(([key, item]) => `${key}:${Array.isArray(item) ? 'array' : typeof item}`)
          .join(',')
      : 'ninguno';
  const field = change && typeof change === 'object' ? (change as { field?: unknown }).field : '';
  const parsedStatus = status ? Status.safeParse(status) : undefined;
  const issue = !parsedStatus
    ? 'sin-estado'
    : parsedStatus.success
      ? 'ok'
      : parsedStatus.error.issues.map((item) => item.path.join('.') || item.code).join(',');
  return `object=${String(root.object)} field=${String(field)} keys=${Object.keys(record).join(',')} status=${types} parse=${issue}`;
}
