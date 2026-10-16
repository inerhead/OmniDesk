import { useEffect } from 'react';
import { Navigate, Outlet, useLocation, useMatch } from 'react-router';
import { useMe } from '@/features/auth/api/use-me';
import { blockedActiveMembership } from '@/features/auth/model/tenant-request';
import {
  BlockedTenantScreen,
  RejectionNoticeDialog,
} from '@/features/auth/ui/tenant-request-screens';
import { inactiveTenantRedirect } from '@/features/company/inactive-tenant';
import {
  clearSignal,
  isConversationsPath,
} from '@/features/conversations/model/new-message-signal';
import { PresenceReporter, PushOpenListener } from '@/features/notifications/push-runtime';
import { OfflineBanner } from '@/shared/pwa/offline-banner';
import { UpdatePrompt } from '@/shared/pwa/update-prompt';
import { BottomNav } from './bottom-nav';
import { NavRail } from './nav-rail';
import { RealtimeProvider } from './realtime-provider';

/**
 * Escritorio (≥ md): rail a la izquierda y la página a la derecha.
 * Móvil: la página arriba y la barra inferior, que se oculta con un chat abierto para dejar todo
 * el alto al composer.
 * Con la empresa activa en revisión o suspendida (SPEC 18), toda ruta muestra la espera o el aviso y
 * no se abre el socket (el gateway lo rechazaría): la pantalla consulta `/me` cada 30 s.
 */
export function AppLayout() {
  const inChat = useMatch('/conversations/:conversationId') !== null;
  const { data: me } = useMe();
  const pathname = useLocation().pathname;
  const blocked = blockedActiveMembership(me);
  const redirect = blocked ? null : inactiveTenantRedirect(me, pathname);
  const onConversations = isConversationsPath(pathname);

  // Entrar a Conversaciones apaga el aviso de mensaje nuevo (SPEC 21).
  useEffect(() => {
    if (onConversations) clearSignal();
  }, [onConversations]);

  return (
    // `key`: al cambiar de empresa activa (o de estado), el socket se cierra y se abre con el room nuevo.
    <RealtimeProvider
      key={`${me?.activeTenantId ?? 'none'}:${blocked?.tenantState ?? 'open'}`}
      enabled={!blocked}
    >
      <div className="flex h-full min-h-0">
        <NavRail />
        <div className="flex min-w-0 flex-1 flex-col">
          <OfflineBanner />
          {/* Cada página controla su propio scroll: la bandeja usa paneles con scroll independiente. */}
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {blocked ? (
              <BlockedTenantScreen membership={blocked} />
            ) : redirect ? (
              <Navigate to={redirect} replace />
            ) : (
              <Outlet />
            )}
          </main>
          {!inChat && <BottomNav />}
        </div>
        <UpdatePrompt />
        <RejectionNoticeDialog me={me} />
        <PresenceReporter />
        <PushOpenListener />
      </div>
    </RealtimeProvider>
  );
}
