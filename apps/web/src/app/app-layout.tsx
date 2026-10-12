import { Outlet, useMatch } from 'react-router';
import { OfflineBanner } from '@/shared/pwa/offline-banner';
import { UpdatePrompt } from '@/shared/pwa/update-prompt';
import { BottomNav } from './bottom-nav';
import { NavRail } from './nav-rail';

/**
 * Escritorio (≥ md): rail a la izquierda y la página a la derecha.
 * Móvil: la página arriba y la barra inferior, que se oculta con un chat abierto para dejar todo
 * el alto al composer.
 */
export function AppLayout() {
  const inChat = useMatch('/conversations/:conversationId') !== null;

  return (
    <div className="flex h-dvh">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        {/* Cada página controla su propio scroll: la bandeja usa paneles con scroll independiente. */}
        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
        {!inChat && <BottomNav />}
      </div>
      <UpdatePrompt />
    </div>
  );
}
