import { z } from 'zod';

export const REALTIME_PATH = '/api/realtime';

/** Nombre del evento de Socket.IO. */
export const CONVERSATION_CHANGED_EVENT = 'conversation.changed';

/** Evento ligero: dice qué cambió, no trae el contenido. La web vuelve a pedir por REST. */
export const RealtimeEventSchema = z.object({
  type: z.literal('conversation.changed'),
  conversationId: z.uuid(),
  /** 'message' (SPEC 03) y 'assignment' (SPEC 04); el SPEC 05 añade 'delivery'. */
  reason: z.enum(['message', 'assignment']),
  occurredAt: z.iso.datetime(),
});
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;
