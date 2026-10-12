import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '@/features/health/api/fetch-health';
import { toStatusView } from '@/features/health/model/to-status-view';
import { HealthCard } from '@/features/health/ui/health-card';
import { useOnlineStatus } from '@/shared/pwa/use-online-status';

const HEALTH_REFRESH_MS = 10_000;

export function StatusPage() {
  const online = useOnlineStatus();
  const health = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: HEALTH_REFRESH_MS,
    retry: false,
  });

  const waitingFirstCheck = online && health.isPending;
  // Tras un error, `data` conserva el último éxito: se descarta para mostrar "API: no disponible".
  const view = waitingFirstCheck
    ? null
    : toStatusView(health.isError ? null : (health.data ?? null), online);

  return (
    <div className="h-full overflow-y-auto">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
        <h1 className="text-2xl font-semibold tracking-tight">Estado del sistema</h1>
        <HealthCard view={view} />
      </section>
    </div>
  );
}
