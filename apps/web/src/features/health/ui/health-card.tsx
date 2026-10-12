import {
  Activity,
  CircleCheck,
  CircleX,
  TriangleAlert,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import type { StatusView } from '../model/to-status-view';

const badgeVariant: Record<StatusView['kind'], ComponentProps<typeof Badge>['variant']> = {
  ok: 'success',
  'db-down': 'warning',
  'api-down': 'destructive',
  offline: 'secondary',
};

const badgeText: Record<StatusView['kind'], string> = {
  ok: 'Operativo',
  'db-down': 'Degradado',
  'api-down': 'Caído',
  offline: 'Sin red',
};

const statusIcon: Record<StatusView['kind'], { icon: LucideIcon; className: string }> = {
  ok: { icon: CircleCheck, className: 'bg-success/15 text-success' },
  'db-down': {
    icon: TriangleAlert,
    className: 'bg-warning/20 text-warning-foreground dark:text-warning',
  },
  'api-down': { icon: CircleX, className: 'bg-destructive/15 text-destructive' },
  offline: { icon: WifiOff, className: 'bg-muted text-muted-foreground' },
};

/** `view = null` mientras se hace la primera comprobación. */
export function HealthCard({ view }: { view: StatusView | null }) {
  const status = view ? statusIcon[view.kind] : null;
  const Icon = status?.icon;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="text-primary size-4" aria-hidden />
          API y base de datos
        </CardTitle>
        <CardDescription>Se actualiza automáticamente cada 10 segundos.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {status && Icon ? (
            <span
              className={cn(
                'flex size-10 items-center justify-center rounded-full',
                status.className,
              )}
            >
              <Icon className="size-5" aria-hidden />
            </span>
          ) : (
            <Skeleton className="size-10 rounded-full" />
          )}
          <p className="text-lg font-medium" role="status" aria-live="polite">
            {view ? view.label : 'Comprobando…'}
          </p>
        </div>
        {view && <Badge variant={badgeVariant[view.kind]}>{badgeText[view.kind]}</Badge>}
      </CardContent>
    </Card>
  );
}
