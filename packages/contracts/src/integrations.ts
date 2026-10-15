import { z } from 'zod';

/** Teléfono en formato E.164, p. ej. "+573001234567". */
export const E164Schema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, 'Debe ser un teléfono E.164 (+573001234567)');

export const MessageTextSchema = z.string().min(1).max(4096);

/** `POST /api/v1/integrations/messages/inbound`: mensaje recibido del cliente. */
export const InboundMessageRequestSchema = z.object({
  externalMessageId: z.string().min(1).max(200),
  from: z.object({
    externalId: E164Schema,
    displayName: z.string().min(1).max(120).optional(),
  }),
  text: MessageTextSchema,
  /** Fecha ISO 8601 en la que el proveedor recibió el mensaje. */
  sentAt: z.iso.datetime({ offset: true }),
});
export type InboundMessageRequest = z.infer<typeof InboundMessageRequestSchema>;

export const InboundMessageResponseSchema = z.object({
  conversationId: z.uuid(),
  messageId: z.uuid(),
  /** `true` si la IA puede responder (conversación abierta y sin agente). */
  aiAllowed: z.boolean(),
  /** Versión de control vigente; la IA debe presentarla al registrar su respuesta. */
  controlVersion: z.int().min(0),
  /** `true` si el `externalMessageId` ya estaba registrado. */
  duplicate: z.boolean(),
});
export type InboundMessageResponse = z.infer<typeof InboundMessageResponseSchema>;

/** `POST /api/v1/integrations/messages/outbound`: respuesta de IA, registrada antes de enviarla. */
export const OutboundAiMessageRequestSchema = z.object({
  conversationId: z.uuid(),
  controlVersion: z.int().min(0),
  idempotencyKey: z.string().min(1).max(200),
  text: MessageTextSchema,
});
export type OutboundAiMessageRequest = z.infer<typeof OutboundAiMessageRequestSchema>;

export const OutboundAiMessageResponseSchema = z.object({
  messageId: z.uuid(),
  sendAllowed: z.literal(true),
});
export type OutboundAiMessageResponse = z.infer<typeof OutboundAiMessageResponseSchema>;

/** Cuerpo del `409`: la IA no debe enviar el mensaje. */
export const OutboundAiMessageRejectedSchema = z.object({
  sendAllowed: z.literal(false),
  /** `TENANT_INACTIVE`: la empresa está inactiva (SPEC 16). */
  reason: z.enum([
    'CONTROL_CHANGED',
    'CONVERSATION_CLOSED',
    'WINDOW_CLOSED',
    'TENANT_INACTIVE',
    'TENANT_SUSPENDED',
  ]),
});
export type OutboundAiMessageRejected = z.infer<typeof OutboundAiMessageRejectedSchema>;

/** `POST /api/v1/integrations/messages/status`: la integración reporta el estado de entrega. */
export const DeliveryStatusSchema = z.enum(['SENT', 'DELIVERED', 'READ', 'FAILED']);
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

export const DeliveryStatusRequestSchema = z.object({
  messageId: z.uuid(),
  providerMessageId: z.string().min(1).max(200),
  status: DeliveryStatusSchema,
  occurredAt: z.iso.datetime(),
  error: z.string().max(500).optional(),
});
export type DeliveryStatusRequest = z.infer<typeof DeliveryStatusRequestSchema>;

export const DeliveryStatusResponseSchema = z.object({
  /** `false` si el reporte se ignoró (repetido o fuera de orden). */
  applied: z.boolean(),
  status: z.enum(['RECEIVED', 'PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED']),
});
export type DeliveryStatusResponse = z.infer<typeof DeliveryStatusResponseSchema>;
