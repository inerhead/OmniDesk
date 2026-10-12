import { Badge } from '@/shared/ui/badge';
import { cn } from '@/shared/lib/utils';
import { useConnectionStatus, type ConnectionStatus } from './connection-status';

const VIEW: Record<ConnectionStatus, { label: string; dot: string }> = {
  live: { label: 'En vivo', dot: 'bg-success' },
  reconnecting: { label: 'Reconectando…', dot: 'bg-warning' },
  connecting: { label: 'Conectando…', dot: 'bg-muted-foreground' },
};

export function ConnectionBadge() {
  const { label, dot } = VIEW[useConnectionStatus()];
  return (
    <Badge variant="outline" role="status" aria-live="polite">
      <span aria-hidden="true" className={cn('size-2 rounded-full', dot)} />
      {label}
    </Badge>
  );
}
