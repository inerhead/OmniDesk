import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNow } from '@/shared/lib/use-now';
import { useOnlineStatus } from '@/shared/pwa/use-online-status';
import { useConnectionStatus } from '@/shared/realtime/connection-status';
import { appendCheck, type CheckRecord } from '../model/check-history';
import { SLOW_LATENCY_MS, toSystemStatus } from '../model/system-status';
import { fetchHealth } from './fetch-health';

export const HEALTH_REFRESH_MS = 10_000;

/** Comprueba el API cada 10 s y guarda en memoria las últimas comprobaciones. */
export function useHealthMonitor() {
  const online = useOnlineStatus();
  const realtime = useConnectionStatus();
  const now = useNow();
  const [history, setHistory] = useState<CheckRecord[]>([]);
  const health = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: HEALTH_REFRESH_MS,
    retry: false,
    enabled: online,
  });

  // Cada comprobación terminada (éxito o error) suma una barra al historial, una sola vez.
  const finishedAt = Math.max(health.dataUpdatedAt, health.errorUpdatedAt);
  const [recordedAt, setRecordedAt] = useState(0);
  if (finishedAt && finishedAt !== recordedAt) {
    setRecordedAt(finishedAt);
    const failed = health.errorUpdatedAt >= health.dataUpdatedAt;
    const check = health.data;
    const result: CheckRecord['result'] =
      failed || !check || check.health.checks.database === 'down'
        ? 'down'
        : check.latencyMs > SLOW_LATENCY_MS
          ? 'degraded'
          : 'up';
    setHistory((previous) =>
      appendCheck(previous, {
        at: finishedAt,
        result,
        latencyMs: failed ? null : (check?.latencyMs ?? null),
      }),
    );
  }

  // Tras un error, `data` conserva el último éxito: se descarta para mostrar "El API no responde".
  const check = health.isPending ? undefined : health.isError ? null : health.data;

  return {
    status: toSystemStatus({ online, check, realtime }),
    history,
    lastCheckedAt: finishedAt || null,
    now,
    checking: health.isFetching,
    checkNow: () => void health.refetch(),
  };
}
