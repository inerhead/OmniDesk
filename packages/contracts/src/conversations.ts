import { z } from 'zod';
import { MessageTextSchema } from './integrations';

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

export const ConversationEventTypeSchema = z.enum(['ASSIGNED', 'RELEASED', 'CLOSED', 'REOPENED']);
export const InboxSchema = z.enum(['ai', 'mine', 'all', 'closed']);

export type ConversationEventType = z.infer<typeof ConversationEventTypeSchema>;
export type Inbox = z.infer<typeof InboxSchema>;
export type SenderType = z.infer<typeof SenderTypeSchema>;
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

/** `GET /api/v1/conversations` */
export const ListConversationsQuerySchema = z.object({
  /** `ai`: abiertas sin agente · `mine`: asignadas al actor · `all`: todas las abiertas (solo OWNER/ADMIN) · `closed`. */
  inbox: InboxSchema.default('ai'),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  /** Nombre del contacto o teléfono; se recorta. Vacío = sin filtro. */
  q: z.string().trim().min(2).max(100).optional(),
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
  /** Agente asignado; se conserva en una conversación cerrada. */
  assignedAgent: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  /** Versión de control vigente; todo comando debe presentarla. */
  controlVersion: z.int().min(0),
  lastMessageAt: z.iso.datetime(),
  lastMessagePreview: z.string(),
  /** Inicio de la conversación. */
  createdAt: z.iso.datetime(),
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

export const MemberRefSchema = z.object({ id: z.uuid(), displayName: z.string() });

export const MessageSchema = z.object({
  id: z.uuid(),
  sequence: z.int().min(1),
  direction: MessageDirectionSchema,
  senderType: SenderTypeSchema,
  text: z.string(),
  status: MessageStatusSchema,
  /** Agente que escribió el mensaje; `null` si no es de un agente. */
  sender: MemberRefSchema.nullable(),
  /** Motivo del último fallo de envío; `null` si no falló. */
  failureReason: z.string().nullable(),
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

/** `GET /api/v1/conversations/:id/timeline`: mensajes y eventos intercalados por `sequence`. */
export const ListTimelineQuerySchema = ListMessagesQuerySchema;
export type ListTimelineQuery = ListMessagesQuery;

export const TimelineMessageSchema = MessageSchema.extend({ kind: z.literal('message') });
export const TimelineEventSchema = z.object({
  kind: z.literal('event'),
  id: z.uuid(),
  sequence: z.int().min(1),
  type: ConversationEventTypeSchema,
  /** `null` = sistema (reapertura por un mensaje del cliente). */
  actor: MemberRefSchema.nullable(),
  /** Agente asignado en `ASSIGNED`. */
  target: MemberRefSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export const TimelineItemSchema = z.discriminatedUnion('kind', [
  TimelineMessageSchema,
  TimelineEventSchema,
]);
export type TimelineItem = z.infer<typeof TimelineItemSchema>;

export const ListTimelineResponseSchema = z.object({
  /** Orden ascendente por `sequence`. */
  items: z.array(TimelineItemSchema),
  /** `sequence` más antigua de la página; `null` si no hay anteriores. */
  prevCursor: z.int().min(1).nullable(),
});
export type ListTimelineResponse = z.infer<typeof ListTimelineResponseSchema>;

/** `POST /api/v1/conversations/:id/assign` */
export const AssignConversationRequestSchema = z.object({
  memberId: z.uuid(),
  controlVersion: z.int().min(0),
});
export type AssignConversationRequest = z.infer<typeof AssignConversationRequestSchema>;

/** `POST /api/v1/conversations/:id/{release,close,reopen}` */
export const ConversationCommandRequestSchema = z.object({
  controlVersion: z.int().min(0),
});
export type ConversationCommandRequest = z.infer<typeof ConversationCommandRequestSchema>;

/** Estado de la conversación tras el comando. */
export const ConversationCommandResponseSchema = ConversationSummarySchema;
export type ConversationCommandResponse = ConversationSummary;

/** Cuerpo del `409`. */
export const ConversationCommandRejectedSchema = z.object({
  reason: z.enum(['CONTROL_CHANGED', 'INVALID_STATE']),
});
export type ConversationCommandRejected = z.infer<typeof ConversationCommandRejectedSchema>;

/** `POST /api/v1/conversations/:id/messages`: el agente asignado responde desde la PWA. */
export const SendAgentMessageRequestSchema = z.object({
  text: MessageTextSchema,
  /** uuid generado en la web: un reintento por error de red no duplica el mensaje. */
  clientMessageId: z.uuid(),
});
export type SendAgentMessageRequest = z.infer<typeof SendAgentMessageRequestSchema>;

/** El mensaje recién registrado (`PENDING`). */
export const SendAgentMessageResponseSchema = MessageSchema;
export type SendAgentMessageResponse = Message;
