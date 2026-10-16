import { z } from 'zod';
import { ChannelTypeSchema } from './conversations';
import { E164Schema, MessageTextSchema } from './integrations';

export const ChannelProviderSchema = z.enum(['SIMULATED', 'N8N', 'CUSTOM', 'WHATSAPP_CLOUD']);
export type ChannelProvider = z.infer<typeof ChannelProviderSchema>;

/** Canal de la empresa (`GET /api/v1/channels`). Nunca incluye secretos. */
export const ChannelSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: ChannelTypeSchema,
  provider: ChannelProviderSchema,
  phoneNumber: E164Schema.nullable(),
  /** phone_number_id de Meta. */
  externalId: z.string(),
  webhookUrl: z.url().nullable(),
  aiEnabled: z.boolean().default(false),
  hasWhatsAppCredentials: z.boolean().default(false),
  /** Tiene `clientSecret` para n8n; el `clientId` es `id` (SPEC 22). El secreto nunca se devuelve. */
  hasN8nClientSecret: z.boolean(),
  whatsappWebhookUrl: z.url().nullable().default(null),
  credentialsRotatedAt: z.iso.datetime().nullable(),
});
export type Channel = z.infer<typeof ChannelSchema>;

export const ListChannelsResponseSchema = z.object({ items: z.array(ChannelSchema) });
export type ListChannelsResponse = z.infer<typeof ListChannelsResponseSchema>;

/** Canal que cualquier miembro puede elegir en la bandeja (`GET /api/v1/channels/inbox`). */
export const InboxChannelSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: ChannelTypeSchema,
});
export type InboxChannel = z.infer<typeof InboxChannelSchema>;

export const ListInboxChannelsResponseSchema = z.object({
  items: z.array(InboxChannelSchema),
});
export type ListInboxChannelsResponse = z.infer<typeof ListInboxChannelsResponseSchema>;

const ChannelNameSchema = z.string().trim().min(1).max(80);

/** `POST /api/v1/channels`: solo WhatsApp Cloud; ya no se crean canales N8N (SPEC 22). */
export const CreateChannelRequestSchema = z.object({
  name: ChannelNameSchema,
  phoneNumber: E164Schema,
  externalId: z.string().trim().min(1).max(64),
  provider: z.literal('WHATSAPP_CLOUD'),
});
export type CreateChannelRequest = z.infer<typeof CreateChannelRequestSchema>;

/** `PATCH /api/v1/channels/:id` */
export const UpdateChannelRequestSchema = z
  .object({ name: ChannelNameSchema.optional(), webhookUrl: z.url().nullable().optional() })
  .refine((body) => body.name !== undefined || body.webhookUrl !== undefined, {
    message: 'Indica name o webhookUrl',
  });
export type UpdateChannelRequest = z.infer<typeof UpdateChannelRequestSchema>;

/**
 * `POST /api/v1/channels/:id/n8n-client`: genera (o regenera) el secreto que OmniDesk envía a n8n en
 * `X-Client-Secret`. Solo aparece en esta respuesta (SPEC 22).
 */
export const N8nClientCredentialsResponseSchema = z.object({
  /** El id del canal: va en `X-Client-Id`. */
  clientId: z.uuid(),
  clientSecret: z.string(),
});
export type N8nClientCredentialsResponse = z.infer<typeof N8nClientCredentialsResponseSchema>;

/** `POST /api/v1/channels/:id/test`: un `ping` firmado al webhook, sin reintentos. */
export const ChannelTestResponseSchema = z.object({
  ok: z.boolean(),
  httpStatus: z.int().nullable(),
  latencyMs: z.int(),
  error: z.string().nullable(),
});
export type ChannelTestResponse = z.infer<typeof ChannelTestResponseSchema>;

/** Cuerpo del `ping` que recibe el webhook de n8n (`POST /channels/:id/test`). */
export const N8nPingRequestSchema = z.object({
  type: z.literal('ping'),
  channelId: z.uuid(),
  at: z.iso.datetime(),
});
export type N8nPingRequest = z.infer<typeof N8nPingRequestSchema>;

/** Petición saliente de OmniDesk al webhook de n8n para enviar un mensaje de agente. */
export const N8nSendMessageRequestSchema = z.object({
  type: z.literal('message.send'),
  messageId: z.uuid(),
  conversationId: z.uuid(),
  channel: z.object({ id: z.uuid(), externalId: z.string() }),
  to: E164Schema,
  text: MessageTextSchema,
});
export type N8nSendMessageRequest = z.infer<typeof N8nSendMessageRequestSchema>;

/** Respuesta `2xx` del webhook de n8n: el id del mensaje en WhatsApp. */
export const N8nSendMessageResponseSchema = z.object({
  providerMessageId: z.string().min(1).max(200),
});
export type N8nSendMessageResponse = z.infer<typeof N8nSendMessageResponseSchema>;

/** Secretos write-only: omitir un campo conserva su valor actual. */
export const ConfigureWhatsAppRequestSchema = z
  .object({
    accessToken: z.string().trim().min(1).max(4096).optional(),
    appSecret: z.string().trim().min(16).max(256).optional(),
    verifyToken: z.string().trim().min(24).max(256).optional(),
    aiEnabled: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Indica una configuración' });
export type ConfigureWhatsAppRequest = z.infer<typeof ConfigureWhatsAppRequestSchema>;
export const N8nAiReplyResponseSchema = z.object({ text: MessageTextSchema });
