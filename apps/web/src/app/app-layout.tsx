import { Outlet } from 'react-router';
import { InstallPrompt } from '@/shared/pwa/install-prompt';
import { OfflineBanner } from '@/shared/pwa/offline-banner';
import { UpdatePrompt } from '@/shared/pwa/update-prompt';

export function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <OfflineBanner />
      <header className="border-b">
        <div className="mx-auto flex min-h-14 max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <span className="flex items-center gap-2 font-semibold">
            <img src="/logo.svg" alt="" className="size-6" />
            OmniDesk
          </span>
          <InstallPrompt />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <UpdatePrompt />
    </div>
  );
}
