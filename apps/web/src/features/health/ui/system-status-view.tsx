import {
  Activity,
  CircleAlert,
  CircleCheck,
  CircleX,
  Database,
  Loader2,
  RefreshCw,
  Server,
  Smartphone,
  WifiOff,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Tooltip } from '@/shared/ui/tooltip';
import { HEALTH_REFRESH_MS, useHealthMonitor } from '../api/use-health-monitor';
import {
  formatAgo,
  HISTORY_SIZE,
  summarizeHistory,
  type CheckRecord,
} from '../model/check-history';
import type { ComponentState, ComponentStatus, Overall } from '../model/system-status';

const OVERALL: Record<Overall, { icon: LucideIcon; tone: string; iconClass?: string }> = {
  operational: { icon: CircleCheck, tone: 'border-success/30 bg-success/10 text-success' },
  degraded: {
    icon: CircleAlert,
    tone: 'border-warning/40 bg-warning/15 text-warning-foreground dark:text-warning',
  },
  down: { icon: CircleX, tone: 'border-destructive/30 bg-destructive/10 text-destructive' },
  offline: { icon: WifiOff, tone: 'border-border bg-muted text-muted-foreground' },
  checking: {
    icon: Loader2,
    tone: 'border-border bg-muted text-muted-foreground',
    iconClass: 'animate-spin',
  },
};

const COMPONENT_ICON: Record<ComponentStatus['id'], LucideIcon> = {
  network: Smartphone,
  api: Server,
  database: Database,
  realtime: Zap,
};

const DOT: Record<ComponentState, string> = {
  up: 'bg-success',
  degraded: 'bg-warning animate-pulse motion-reduce:animate-none',
  down: 'bg-destructive',
  unknown: 'bg-muted-foreground/50',
};

const STATE_TEXT: Record<ComponentState, string> = {
  up: 'text-success',
  degraded: 'text-warning-foreground dark:text-warning',
  down: 'text-destructive',
  unknown: 'text-muted-foreground',
};

const BAR: Record<CheckRecord['result'], string> = {
  up: 'bg-success',
  degraded: 'bg-warning',
  down: 'bg-destructive',
};

const timeFormat = new Intl.DateTimeFormat('es', { timeStyle: 'medium' });

function ComponentRow({ component }: { component: ComponentStatus }) {
  const Icon = COMPONENT_ICON[component.id];
  return (
    <li className="flex items-center gap-3 px-4 py-3.5 sm:px-6">
      <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{component.name}</span>
        <span className="text-muted-foreground truncate text-xs">{component.description}</span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span
          className={cn(
            'flex items-center gap-1.5 text-sm font-medium',
            STATE_TEXT[component.state],
          )}
        >
          <span aria-hidden className={cn('size-2 rounded-full', DOT[component.state])} />
          {component.stateLabel}
        </span>
        {component.detail && (
          <span className="text-muted-foreground text-xs tabular-nums">{component.detail}</span>
        )}
      </div>
    </li>
  );
}

function HistoryBars({ history }: { history: CheckRecord[] }) {
  const empty = HISTORY_SIZE - history.length;
  const maxLatency = Math.max(100, ...history.map((record) => record.latencyMs ?? 0));
  return (
    <div className="flex h-12 items-end gap-1" role="img" aria-label="Últimas comprobaciones">
      {Array.from({ length: empty }, (_, index) => (
        <span key={`empty-${index}`} className="bg-muted h-2 flex-1 rounded-sm" />
      ))}
      {history.map((record) => {
        // Altura según latencia (mínimo 30 %); una caída ocupa toda la barra.
        const height =
          record.result === 'down' || record.latencyMs === null
            ? 100
            : 30 + (record.latencyMs / maxLatency) * 70;
        return (
          <Tooltip
            key={record.at}
            side="top"
            content={`${timeFormat.format(record.at)} · ${
              record.result === 'down' ? 'Sin respuesta' : `${record.latencyMs} ms`
            }`}
          >
            <span
              tabIndex={0}
              className={cn(
                'flex-1 rounded-sm opacity-80 transition-opacity outline-none hover:opacity-100 focus-visible:opacity-100',
                BAR[record.result],
              )}
              style={{ height: `${height}%` }}
            />
          </Tooltip>
        );
      })}
    </div>
  );
}

/** Página Estado: resumen general, estado por componente e historial reciente de este dispositivo. */
export function SystemStatusView() {
  const { status, history, lastCheckedAt, now, checking, checkNow } = useHealthMonitor();
  const overall = OVERALL[status.overall];
  const OverallIcon = overall.icon;
  const summary = summarizeHistory(history);
  const nextIn = lastCheckedAt
    ? Math.max(0, Math.ceil((lastCheckedAt + HEALTH_REFRESH_MS - now) / 1000))
    : null;

  return (
    <div className="flex flex-col gap-6">
      <section
        role="status"
        aria-live="polite"
        className={cn('flex items-start gap-4 rounded-xl border p-5 sm:items-center', overall.tone)}
      >
        <OverallIcon className={cn('size-8 shrink-0', overall.iconClass)} aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-foreground text-lg font-semibold">{status.title}</p>
          <p className="text-muted-foreground text-sm">{status.description}</p>
        </div>
      </section>

      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 text-sm">
        <span>
          {lastCheckedAt
            ? `Última comprobación ${formatAgo(lastCheckedAt, now)}`
            : 'Sin comprobaciones aún'}
          {nextIn !== null && !checking && ` · próxima en ${nextIn} s`}
        </span>
        <Button size="sm" variant="outline" onClick={checkNow} disabled={checking}>
          <RefreshCw className={cn(checking && 'animate-spin')} aria-hidden />
          {checking ? 'Comprobando…' : 'Comprobar ahora'}
        </Button>
      </div>

      <Card className="gap-0 py-0">
        <ul className="divide-y">
          {status.components.map((component) => (
            <ComponentRow key={component.id} component={component} />
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="text-primary size-4" aria-hidden />
            Historial reciente
          </CardTitle>
          <CardDescription>
            Últimas {HISTORY_SIZE} comprobaciones desde que abriste esta página (una cada 10 s).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <HistoryBars history={history} />
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground text-xs">Disponibilidad</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {summary.availability === null ? '—' : `${summary.availability} %`}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground text-xs">Latencia media</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {summary.averageLatencyMs === null ? '—' : `${summary.averageLatencyMs} ms`}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground text-xs">Comprobaciones</dt>
              <dd className="text-lg font-semibold tabular-nums">{history.length}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
