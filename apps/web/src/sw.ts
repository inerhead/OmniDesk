/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

const base = import.meta.env.BASE_URL;
const indexUrl = `${base}index.html`;
// En desarrollo el manifiesto llega vacío. createHandlerBoundToURL lanza y el
// worker no llega a instalarse, así que el navegador no puede suscribirse.
const hasAppShell = self.__WB_MANIFEST.some((entry) => {
  const url = typeof entry === 'string' ? entry : entry.url;
  return url === indexUrl || url === 'index.html';
});
if (hasAppShell) {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  registerRoute(
    new NavigationRoute(createHandlerBoundToURL(indexUrl), {
      denylist: [new RegExp(`^${escaped}api/`)],
    }),
  );
}

interface PushData {
  title?: string;
  body?: string;
  tag?: string;
  url?: string;
  tenantId?: string;
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('push', (event) => {
  const data = event.data?.json() as PushData | undefined;
  event.waitUntil(
    self.registration.showNotification(data?.title || 'OmniDesk', {
      body: data?.body ?? '',
      tag: data?.tag,
      icon: `${base}pwa-192x192.png`,
      data: { url: data?.url ?? base, tenantId: data?.tenantId ?? '' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const payload = (event.notification.data ?? {}) as { url?: string; tenantId?: string };
  event.waitUntil(openConversation(payload.url ?? base, payload.tenantId ?? ''));
});

async function openConversation(url: string, tenantId: string): Promise<void> {
  const absolute = new URL(url, self.location.origin);
  if (tenantId) absolute.searchParams.set('tenant', tenantId);
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existing = windows.find((client) => 'focus' in client);
  if (existing) {
    await existing.focus();
    existing.postMessage({ type: 'push-open', url, tenantId });
    return;
  }
  await self.clients.openWindow(absolute.href);
}
