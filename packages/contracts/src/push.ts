import { z } from 'zod';

/** Clave pública VAPID. Si el entorno no tiene claves, el API responde 404. */
export const PushConfigResponseSchema = z.object({
  vapidPublicKey: z.string(),
});
export type PushConfigResponse = z.infer<typeof PushConfigResponseSchema>;

export const PushSubscriptionRequestSchema = z.object({
  endpoint: z.url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
export type PushSubscriptionRequest = z.infer<typeof PushSubscriptionRequestSchema>;

/** Interruptores por miembro de una empresa. */
export const NotificationPreferencesSchema = z.object({
  assigned: z.boolean(),
  customerMessage: z.boolean(),
  sendFailed: z.boolean(),
  newAiConversation: z.boolean(),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;

/** Lo que la web emite por Socket.IO al abrir un chat o cambiar de pestaña. */
export const PresenceEventSchema = z.object({
  conversationId: z.uuid().nullable(),
  visible: z.boolean(),
});
export type PresenceEvent = z.infer<typeof PresenceEventSchema>;
