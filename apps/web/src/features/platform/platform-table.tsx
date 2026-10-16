import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';
import { Card } from '@/shared/ui/card';

/**
 * Celda de la tabla. En móvil lleva su encabezado encima (`label`), porque la fila de encabezados
 * solo se ve en ≥ md.
 */
export function PlatformCell({
  label,
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5 text-sm', className)}>
      {label && <span className="text-muted-foreground text-xs md:hidden">{label}</span>}
      {children}
    </div>
  );
}

/** Tabla de `/platform`: fila de encabezados (≥ md) y una fila por empresa. */
export function PlatformTable({
  columns,
  grid,
  children,
}: {
  columns: string[];
  grid: string;
  children: ReactNode;
}) {
  return (
    <Card className="gap-0 py-0">
      <div
        aria-hidden
        className={cn(
          'text-muted-foreground hidden gap-4 border-b px-4 py-2 text-xs font-medium md:grid',
          grid,
        )}
      >
        {columns.map((column) => (
          <span key={column} className={cn('truncate', column === 'Acciones' && 'text-right')}>
            {column}
          </span>
        ))}
      </div>
      <ul className="divide-y">{children}</ul>
    </Card>
  );
}
