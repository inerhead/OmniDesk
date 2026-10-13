import { cn } from '@/shared/lib/utils';
import { CONNECTION_LABEL, useConnectionStatus, type ConnectionStatus } from './connection-status';

interface StatusView {
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
    dot: 'bg-success',
    effect: 'bg-success/60 animate-ping [animation-duration:2s]',
  },
  reconnecting: {
    dot: 'bg-warning animate-pulse [animation-duration:1s]',
    effect: 'ring-warning/40 ring-4',
  },
  connecting: {
    dot: 'bg-muted-foreground',
    effect:
      '-inset-1 border-2 border-muted-foreground/50 border-t-transparent animate-spin [animation-duration:1.2s]',
  },
};

/**
 * Punto de color con el estado del socket, pensado para la esquina de un avatar. El texto va en el
 * nombre accesible (región `status`), así que el cambio se anuncia sin necesidad de foco.
 */
export function ConnectionDot({ className }: { className?: string }) {
  const status = useConnectionStatus();
  const { dot, effect } = VIEW[status];
  const label = CONNECTION_LABEL[status];
  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn('pointer-events-none flex size-3 rounded-full', className)}
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
  );
}
