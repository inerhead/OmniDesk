import { z } from 'zod';

export const REALTIME_PATH = '/api/realtime';

/** Nombre del evento de Socket.IO. */
export const CONVERSATION_CHANGED_EVENT = 'conversation.changed';

/** Evento ligero: dice qué cambió, no trae el contenido. La web vuelve a pedir por REST. */
export const RealtimeEventSchema = z.object({
  type: z.literal('conversation.changed'),
  conversationId: z.uuid(),
  /** 'message' (SPEC 03); el SPEC 04 añade 'assignment' y el SPEC 05 'delivery'. */
  reason: z.enum(['message']),
  occurredAt: z.iso.datetime(),
});
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;
