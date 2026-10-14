import { Outlet, useMatch } from 'react-router';
import { useMe } from '@/features/auth/api/use-me';
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
 */
export function AppLayout() {
  const inChat = useMatch('/conversations/:conversationId') !== null;
  const { data: me } = useMe();

  return (
    // `key`: al cambiar de empresa activa, el socket se cierra y se abre con el room nuevo.
    <RealtimeProvider key={me?.activeTenantId ?? 'none'}>
      <div className="flex h-full min-h-0">
        <NavRail />
        <div className="flex min-w-0 flex-1 flex-col">
          <OfflineBanner />
          {/* Cada página controla su propio scroll: la bandeja usa paneles con scroll independiente. */}
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </main>
          {!inChat && <BottomNav />}
        </div>
        <UpdatePrompt />
        <PresenceReporter />
        <PushOpenListener />
      </div>
    </RealtimeProvider>
  );
}
