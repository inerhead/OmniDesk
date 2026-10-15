import { z } from 'zod';

export const REALTIME_PATH = '/api/realtime';

/** Nombre del evento de Socket.IO. */
export const CONVERSATION_CHANGED_EVENT = 'conversation.changed';

/** Evento ligero: dice qué cambió, no trae el contenido. La web vuelve a pedir por REST. */
export const RealtimeEventSchema = z.object({
  type: z.literal('conversation.changed'),
  conversationId: z.uuid(),
  /**
   * 'message' (SPEC 03), 'assignment' (SPEC 04), 'delivery' (SPEC 05) y 'deleted' (SPEC 12: se borró
   * el contacto y su historial; la web la quita de la lista).
   */
  reason: z.enum(['message', 'assignment', 'delivery', 'deleted']),
  occurredAt: z.iso.datetime(),
});
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;

/** Una empresa se inactivó o se reactivó (SPEC 16): la web vuelve a pedir `/me`. */
export const TENANT_STATUS_CHANGED_EVENT = 'tenant.status_changed';

export const TenantStatusChangedEventSchema = z.object({
  type: z.literal('tenant.status_changed'),
  tenantId: z.uuid(),
  active: z.boolean(),
  occurredAt: z.iso.datetime(),
});
export type TenantStatusChangedEvent = z.infer<typeof TenantStatusChangedEventSchema>;
