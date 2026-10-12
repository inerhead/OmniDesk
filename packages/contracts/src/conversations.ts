import { z } from 'zod';

export const ConversationStatusSchema = z.enum(['OPEN', 'CLOSED']);
export const ChannelTypeSchema = z.enum(['WHATSAPP']);
export const SenderTypeSchema = z.enum(['CUSTOMER', 'AI', 'AGENT']);
export const MessageDirectionSchema = z.enum(['INBOUND', 'OUTBOUND']);
export const MessageStatusSchema = z.enum([
  'RECEIVED',
  'PENDING',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
]);

export type SenderType = z.infer<typeof SenderTypeSchema>;
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

/** `GET /api/v1/conversations` */
export const ListConversationsQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListConversationsQuery = z.infer<typeof ListConversationsQuerySchema>;

export const ConversationSummarySchema = z.object({
  id: z.uuid(),
  status: ConversationStatusSchema,
  /** La IA atiende: conversación abierta y sin agente asignado. */
  aiActive: z.boolean(),
  contact: z.object({
    id: z.uuid(),
    displayName: z.string().nullable(),
    externalId: z.string(),
  }),
  channel: z.object({
    id: z.uuid(),
    name: z.string(),
    type: ChannelTypeSchema,
  }),
  lastMessageAt: z.iso.datetime(),
  lastMessagePreview: z.string(),
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

export const ListConversationsResponseSchema = z.object({
  items: z.array(ConversationSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ListConversationsResponse = z.infer<typeof ListConversationsResponseSchema>;

/** `GET /api/v1/conversations/:id/messages` */
export const ListMessagesQuerySchema = z.object({
  /** Devuelve los mensajes con `sequence` menor. Sin `before`: la página más reciente. */
  before: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListMessagesQuery = z.infer<typeof ListMessagesQuerySchema>;

export const MessageSchema = z.object({
  id: z.uuid(),
  sequence: z.int().min(1),
  direction: MessageDirectionSchema,
  senderType: SenderTypeSchema,
  text: z.string(),
  status: MessageStatusSchema,
  createdAt: z.iso.datetime(),
});
export type Message = z.infer<typeof MessageSchema>;

export const ListMessagesResponseSchema = z.object({
  /** Orden ascendente por `sequence`. */
  items: z.array(MessageSchema),
  /** `sequence` más antigua de la página; `null` si no hay mensajes anteriores. */
  prevCursor: z.int().min(1).nullable(),
});
export type ListMessagesResponse = z.infer<typeof ListMessagesResponseSchema>;
