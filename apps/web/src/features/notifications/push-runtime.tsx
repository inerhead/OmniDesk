import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useMatch, useNavigate, useSearchParams } from 'react-router';
import { postActiveTenant } from '@/features/auth/api/auth-api';
import { resetSessionCache } from '@/features/auth/api/use-session-actions';
import { useMe } from '@/features/auth/api/use-me';
import { basePath } from '@/shared/config/env';
import { emitPresence } from '@/shared/realtime/realtime-client';
import { currentPushSubscription } from './push-api';

/** Se conserva entre chats: así no se reporta `null` mientras se vuelve a leer. */
let knownEndpoint: string | null = null;

/**
 * Reporta la conversación abierta, si la pestaña está visible y la suscripción push de este
 * navegador: el API no avisa en este dispositivo de lo que ya se ve, pero sí en los demás.
 */
export function PresenceReporter() {
  const match = useMatch('/conversations/:conversationId');
  const conversationId = match?.params.conversationId ?? null;

  useEffect(() => {
    let active = true;
    const report = () => {
      emitPresence({
        conversationId,
        visible: document.visibilityState === 'visible',
        endpoint: knownEndpoint,
      });
    };
    // Al volver a la pestaña puede haber cambiado la suscripción (activada o desactivada).
    const refresh = () => {
      report();
      void currentPushSubscription()
        .catch(() => null)
        .then((subscription) => {
          const next = subscription?.endpoint ?? null;
          if (next === knownEndpoint) return;
          knownEndpoint = next;
          if (active) report();
        });
    };
    refresh();
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', refresh);
      emitPresence({
        conversationId: null,
        visible: document.visibilityState === 'visible',
        endpoint: knownEndpoint,
      });
    };
  }, [conversationId]);

  return null;
}

/**
 * Al tocar una notificación: si es de otra empresa, la activa y abre esa conversación.
 * El service worker también puede abrir la ventana con `?tenant=`.
 */
export function PushOpenListener() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tenantFromUrl = params.get('tenant');

  useEffect(() => {
    if (!tenantFromUrl || !me) return;
    const next = new URLSearchParams(params);
    next.delete('tenant');
    const finish = () => setParams(next, { replace: true });
    if (tenantFromUrl === me.activeTenantId) {
      finish();
      return;
    }
    void postActiveTenant(tenantFromUrl)
      .then((updated) => {
        resetSessionCache(queryClient, updated);
        finish();
      })
      .catch(finish);
  }, [tenantFromUrl, me, params, queryClient, setParams]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string; tenantId?: string } | null;
      if (!data || data.type !== 'push-open' || !data.url) return;
      void openFromPush(data.url, data.tenantId ?? '', me?.activeTenantId ?? null);
    };
    async function openFromPush(url: string, tenantId: string, activeTenantId: string | null) {
      if (tenantId && tenantId !== activeTenantId) {
        const updated = await postActiveTenant(tenantId);
        resetSessionCache(queryClient, updated);
      }
      const path = new URL(url, window.location.origin).pathname;
      const relative = basePath && path.startsWith(basePath) ? path.slice(basePath.length) : path;
      void navigate(relative || '/');
    }

    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [me?.activeTenantId, navigate, queryClient]);

  return null;
}
