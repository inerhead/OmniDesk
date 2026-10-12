import { Activity } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Badge } from '@/shared/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
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

/** `view = null` mientras se hace la primera comprobación. */
export function HealthCard({ view }: { view: StatusView | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4" aria-hidden />
          Estado del sistema
        </CardTitle>
        <CardDescription>Se actualiza automáticamente cada 10 segundos.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-lg font-medium" role="status" aria-live="polite">
          {view ? view.label : 'Comprobando…'}
        </p>
        {view && <Badge variant={badgeVariant[view.kind]}>{badgeText[view.kind]}</Badge>}
      </CardContent>
    </Card>
  );
}
