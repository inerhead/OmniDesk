/** Una comprobación del historial reciente (solo en memoria, en este dispositivo). */
export interface CheckRecord {
  at: number;
  result: 'up' | 'degraded' | 'down';
  latencyMs: number | null;
}

export const HISTORY_SIZE = 30;

/** Añade al final y conserva solo las últimas `HISTORY_SIZE`. */
export function appendCheck(history: CheckRecord[], record: CheckRecord): CheckRecord[] {
  return [...history, record].slice(-HISTORY_SIZE);
}

export interface HistorySummary {
  /** % de comprobaciones en que el API y la base de datos respondieron. `null` sin datos. */
  availability: number | null;
  /** Latencia media de las que respondieron. */
  averageLatencyMs: number | null;
}

export function summarizeHistory(history: CheckRecord[]): HistorySummary {
  if (history.length === 0) return { availability: null, averageLatencyMs: null };
  const answered = history.filter((record) => record.result !== 'down');
  const latencies = answered.flatMap((record) =>
    record.latencyMs === null ? [] : [record.latencyMs],
  );
  return {
    availability: Math.round((answered.length / history.length) * 1000) / 10,
    averageLatencyMs: latencies.length
      ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
      : null,
  };
}

/** "hace 4 s", "hace 2 min", "justo ahora". */
export function formatAgo(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 2) return 'justo ahora';
  if (seconds < 60) return `hace ${seconds} s`;
  return `hace ${Math.floor(seconds / 60)} min`;
}
