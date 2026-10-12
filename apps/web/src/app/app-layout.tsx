import { NavLink, Outlet } from 'react-router';
import { cn } from '@/shared/lib/utils';
import { InstallPrompt } from '@/shared/pwa/install-prompt';
import { OfflineBanner } from '@/shared/pwa/offline-banner';
import { UpdatePrompt } from '@/shared/pwa/update-prompt';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
  );

export function AppLayout() {
  return (
    <div className="flex h-dvh flex-col">
      <OfflineBanner />
      <header className="shrink-0 border-b">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-4 py-2">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-2 font-semibold">
              <img src="/logo.svg" alt="" className="size-6" />
              OmniDesk
            </span>
            <nav className="flex items-center gap-1" aria-label="Principal">
              <NavLink to="/conversations" className={navLinkClass}>
                Conversaciones
              </NavLink>
              <NavLink to="/status" className={navLinkClass}>
                Estado
              </NavLink>
            </nav>
          </div>
          <InstallPrompt />
        </div>
      </header>
      {/* Cada página controla su propio scroll: la bandeja usa dos paneles con scroll independiente. */}
      <main className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
      <UpdatePrompt />
    </div>
  );
}
