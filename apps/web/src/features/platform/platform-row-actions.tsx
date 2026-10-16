import type { PlatformTenantRow, PlatformTenantStatus } from '@omnidesk/contracts';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { rowActions, type PlatformRowHandlers } from './platform-actions';

/**
 * Botón principal y menú "⋯" de una fila. Las opciones del menú (Rechazar, Suspender, Borrar) son
 * destructivas y abren los diálogos de SPEC 18 y 20.
 */
export function PlatformRowActions({
  row,
  tab,
  pending,
  handlers,
}: {
  row: PlatformTenantRow;
  tab: PlatformTenantStatus;
  pending: boolean;
  handlers: PlatformRowHandlers;
}) {
  const { main, menu } = rowActions(row, tab, handlers);
  if (!main && menu.length === 0) return null;
  return (
    <div className="flex items-center gap-2 md:justify-end">
      {main && (
        <Button
          size="sm"
          variant={tab === 'pending' ? 'default' : 'outline'}
          disabled={pending}
          onClick={main.run}
        >
          {main.label}
        </Button>
      )}
      {menu.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={pending}>
            <Button size="icon-sm" variant="ghost" aria-label={`Más acciones para ${row.name}`}>
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {menu.map((action) => (
              <DropdownMenuItem
                key={action.label}
                className="text-destructive focus:text-destructive"
                onSelect={action.run}
              >
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
