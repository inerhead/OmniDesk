import { SystemStatusView } from '@/features/health/ui/system-status-view';

export function StatusPage() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-6 pb-10 md:px-8 md:py-10">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Estado del sistema</h1>
          <p className="text-muted-foreground text-sm">
            Cómo ve este dispositivo al API, la base de datos y el tiempo real.
          </p>
        </header>
        <SystemStatusView />
      </section>
    </div>
  );
}
