import { cn } from '@/shared/lib/utils';
import { Tooltip } from '@/shared/ui/tooltip';
import { useConnectionStatus, type ConnectionStatus } from './connection-status';

interface StatusView {
  label: string;
  /** Punto central. */
  dot: string;
  /** Capa animada detrás o alrededor del punto. */
  effect: string;
}

/**
 * - En vivo: punto verde con un halo que late (señal "online").
 * - Reconectando: punto ámbar que parpadea, para que se note el corte.
 * - Conectando: punto gris con un anillo que gira mientras espera.
 * Con "reducir movimiento" no se anima nada: solo cambia el color.
 */
const VIEW: Record<ConnectionStatus, StatusView> = {
  live: {
    label: 'En vivo',
    dot: 'bg-success',
    effect: 'bg-success/60 animate-ping [animation-duration:2s]',
  },
  reconnecting: {
    label: 'Reconectando…',
    dot: 'bg-warning animate-pulse [animation-duration:1s]',
    effect: 'ring-warning/40 ring-4',
  },
  connecting: {
    label: 'Conectando…',
    dot: 'bg-muted-foreground',
    effect:
      '-inset-1 border-2 border-muted-foreground/50 border-t-transparent animate-spin [animation-duration:1.2s]',
  },
};

/** Punto de color con el estado del socket; el texto va en el tooltip y en el nombre accesible. */
export function ConnectionBadge({ side = 'right' }: { side?: 'right' | 'top' }) {
  const status = useConnectionStatus();
  const { label, dot, effect } = VIEW[status];
  return (
    <Tooltip content={label} side={side}>
      <span
        role="status"
        aria-live="polite"
        aria-label={label}
        tabIndex={0}
        className="focus-visible:ring-ring/50 flex size-9 items-center justify-center rounded-md outline-none focus-visible:ring-[3px]"
      >
        <span aria-hidden="true" className="relative flex size-3">
          {/* `key`: al cambiar de estado la animación arranca de cero. */}
          <span
            key={status}
            className={cn('absolute inset-0 rounded-full motion-reduce:animate-none', effect)}
          />
          <span
            className={cn(
              'relative size-3 rounded-full transition-colors duration-300 motion-reduce:animate-none',
              dot,
            )}
          />
        </span>
      </span>
    </Tooltip>
  );
}
