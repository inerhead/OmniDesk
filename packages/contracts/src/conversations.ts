import { z } from 'zod';
import { AttachmentSchema } from './attachments';
import { MessageTextSchema } from './integrations';
import { AvatarUrlSchema } from './profile';

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
  /** Si viene, solo conversaciones de ese canal. Ausente = todos los canales. */
  channelId: z.uuid().optional(),
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
  assignedAgent: z
    .object({ id: z.uuid(), displayName: z.string(), avatarUrl: AvatarUrlSchema })
    .nullable(),
  /** Versión de control vigente; todo comando debe presentarla. */
  controlVersion: z.int().min(0),
  lastMessageAt: z.iso.datetime(),
  lastMessagePreview: z.string(),
  /** Último mensaje del cliente; `null` si no hay. Marca la ventana de respuesta. */
  lastInboundAt: z.iso.datetime().nullable(),
  /** Inicio de la conversación. */
  createdAt: z.iso.datetime(),
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

/** OmniDesk deja de enviar a las 18 h del último mensaje del cliente; Meta corta a las 24 h. */
export const REPLY_WINDOW_HOURS = 18;
export const REPLY_WINDOW_MS = REPLY_WINDOW_HOURS * 60 * 60 * 1000;

export function isReplyWindowOpen(lastInboundAt: Date | string | null, now: Date): boolean {
  if (lastInboundAt === null) return false;
  return now.getTime() - new Date(lastInboundAt).getTime() < REPLY_WINDOW_MS;
}

export const ListConversationsResponseSchema = z.object({
  items: z.array(ConversationSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ListConversationsResponse = z.infer<typeof ListConversationsResponseSchema>;

/** `GET /api/v1/conversations/counts` */
export const InboxCountsQuerySchema = z.object({
  /** Si viene, solo conversaciones de ese canal. Ausente = todos los canales. */
  channelId: z.uuid().optional(),
});
export type InboxCountsQuery = z.infer<typeof InboxCountsQuerySchema>;

/**
 * Conversaciones por bandeja, con los mismos permisos que la lista: `all` solo para OWNER/ADMIN.
 * `closed` no se cuenta: el histórico solo crece.
 */
export const InboxCountsResponseSchema = z.object({
  ai: z.int().min(0),
  mine: z.int().min(0),
  all: z.int().min(0).optional(),
});
export type InboxCountsResponse = z.infer<typeof InboxCountsResponseSchema>;

/** `GET /api/v1/conversations/:id/messages` */
export const ListMessagesQuerySchema = z.object({
  /** Devuelve los mensajes con `sequence` menor. Sin `before`: la página más reciente. */
  before: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListMessagesQuery = z.infer<typeof ListMessagesQuerySchema>;

export const MemberRefSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  avatarUrl: AvatarUrlSchema,
});

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
  /** Archivo del mensaje; el texto es su pie (puede ser vacío). */
  attachment: AttachmentSchema.nullable().default(null),
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
  reason: z.enum(['CONTROL_CHANGED', 'INVALID_STATE', 'WINDOW_CLOSED']),
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
