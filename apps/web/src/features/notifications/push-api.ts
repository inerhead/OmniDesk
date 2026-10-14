import {
  NotificationPreferencesSchema,
  PushConfigResponseSchema,
  type NotificationPreferences,
  type PushConfigResponse,
  type PushSubscriptionRequest,
} from '@omnidesk/contracts';
import { ApiHttpError, deleteJson, getJson, patchJson, postJson } from '@/shared/api/http-client';

export async function fetchPushConfig(): Promise<PushConfigResponse | null> {
  const { status, body } = await getJson('/api/v1/push/config');
  if (status === 404) return null;
  if (status !== 200) throw new ApiHttpError(status);
  return PushConfigResponseSchema.parse(body);
}

export async function postSubscription(body: PushSubscriptionRequest): Promise<void> {
  const { status } = await postJson('/api/v1/push/subscriptions', body);
  if (status !== 201 && status !== 200) throw new ApiHttpError(status);
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  const { status } = await deleteJson('/api/v1/push/subscriptions', { body: { endpoint } });
  if (status !== 204) throw new ApiHttpError(status);
}

export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  const { status, body } = await getJson('/api/v1/me/notification-preferences');
  if (status !== 200) throw new ApiHttpError(status);
  return NotificationPreferencesSchema.parse(body);
}

export async function patchNotificationPreferences(
  body: NotificationPreferences,
): Promise<NotificationPreferences> {
  const { status, body: response } = await patchJson('/api/v1/me/notification-preferences', body);
  if (status !== 200) throw new ApiHttpError(status);
  return NotificationPreferencesSchema.parse(response);
}

export async function postTestPush(): Promise<void> {
  const { status } = await postJson('/api/v1/push/test', undefined);
  if (status !== 204) throw new ApiHttpError(status);
}

function applicationServerKey(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

async function pushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  const registration = await pushRegistration();
  return registration?.pushManager.getSubscription() ?? null;
}

/** Pide permiso en el gesto del usuario, suscribe el dispositivo y lo guarda en el API. */
export async function enablePushOnThisDevice(vapidPublicKey: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('permission-denied');
  const registration = await pushRegistration();
  if (!registration) throw new Error('service-worker');
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(vapidPublicKey),
    }));
  const json = subscription.toJSON();
  if (!json.keys?.p256dh || !json.keys.auth) throw new Error('subscription-keys');
  await postSubscription({
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
}

/** Borra la suscripción de este dispositivo en el API y en el navegador. */
export async function disablePushOnThisDevice(): Promise<void> {
  const registration = await pushRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await deleteSubscription(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe();
}
