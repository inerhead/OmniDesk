import { z } from 'zod';

export const REALTIME_PATH = '/api/realtime';

/** Nombre del evento de Socket.IO. */
export const CONVERSATION_CHANGED_EVENT = 'conversation.changed';

/** Evento ligero: dice qué cambió, no trae el contenido. La web vuelve a pedir por REST. */
export const RealtimeEventSchema = z.object({
  type: z.literal('conversation.changed'),
  conversationId: z.uuid(),
  /** 'message' (SPEC 03), 'assignment' (SPEC 04) y 'delivery' (SPEC 05). */
  reason: z.enum(['message', 'assignment', 'delivery']),
  occurredAt: z.iso.datetime(),
});
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;
