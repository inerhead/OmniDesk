import { cn } from '@/shared/lib/utils';
import { Tooltip } from '@/shared/ui/tooltip';
import { useConnectionStatus, type ConnectionStatus } from './connection-status';

const VIEW: Record<ConnectionStatus, { label: string; dot: string }> = {
  live: { label: 'En vivo', dot: 'bg-success ring-success/20' },
  reconnecting: { label: 'Reconectando…', dot: 'bg-warning ring-warning/25' },
  connecting: { label: 'Conectando…', dot: 'bg-muted-foreground ring-muted-foreground/20' },
};

/** Punto de color con el estado del socket; el texto va en el tooltip y en el nombre accesible. */
export function ConnectionBadge({ side = 'right' }: { side?: 'right' | 'top' }) {
  const { label, dot } = VIEW[useConnectionStatus()];
  return (
    <Tooltip content={label} side={side}>
      <span
        role="status"
        aria-live="polite"
        aria-label={label}
        tabIndex={0}
        className="focus-visible:ring-ring/50 flex size-9 items-center justify-center rounded-md outline-none focus-visible:ring-[3px]"
      >
        <span aria-hidden="true" className={cn('size-2.5 rounded-full ring-4', dot)} />
      </span>
    </Tooltip>
  );
}
