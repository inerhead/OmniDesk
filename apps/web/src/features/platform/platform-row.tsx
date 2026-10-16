import type { PlatformTenantRow, PlatformTenantStatus } from '@omnidesk/contracts';
import type { ReactNode } from 'react';
import { Badge } from '@/shared/ui/badge';
import { formatDate, rowGridClass, TENANT_GRID } from './platform-columns';
import { PlatformCell } from './platform-table';

const STATE: Record<
  NonNullable<PlatformTenantRow['state']>,
  { label: string; variant: 'success' | 'secondary' | 'destructive' }
> = {
  active: { label: 'Activa', variant: 'success' },
  inactive: { label: 'Inactiva', variant: 'secondary' },
  suspended: { label: 'Suspendida', variant: 'destructive' },
};

/**
 * Una empresa o un rechazo, en las columnas de su pestaña (SPEC 21). El motivo del rechazo o de la
 * suspensión va en una línea bajo la fila, a todo el ancho. En móvil se apila.
 */
export function PlatformRow({
  row,
  tab,
  actions,
}: {
  row: PlatformTenantRow;
  tab: PlatformTenantStatus;
  actions: ReactNode;
}) {
  const state = row.state ? STATE[row.state] : null;
  const date = formatDate(
    tab === 'pending' ? row.requestedAt : tab === 'approved' ? row.approvedAt : row.rejectedAt,
  );
  const dateLabel = { pending: 'Pedida', approved: 'Aprobada', rejected: 'Rechazada' }[tab];
  const phone = row.contactPhone ?? 'Sin teléfono';
  const contactEmail = row.contactEmail ?? 'Sin email de contacto';
  const suspensionReason = row.state === 'suspended' ? row.suspensionReason : null;

  return (
    <li>
      <div className={rowGridClass(TENANT_GRID[tab])}>
        <PlatformCell>
          <span className="truncate font-medium" title={row.name}>
            {row.name}
          </span>
          <span className="text-muted-foreground truncate text-xs" title={row.slug}>
            {row.slug}
          </span>
        </PlatformCell>
        <PlatformCell label={tab === 'approved' ? 'Owner' : 'Solicitante'}>
          <span className="truncate" title={row.requester.displayName}>
            {row.requester.displayName}
          </span>
          {row.requester.email && (
            <span className="text-muted-foreground truncate text-xs" title={row.requester.email}>
              {row.requester.email}
            </span>
          )}
        </PlatformCell>
        <PlatformCell label="Contacto">
          <span className="truncate" title={phone}>
            {phone}
          </span>
          <span className="text-muted-foreground truncate text-xs" title={contactEmail}>
            {contactEmail}
          </span>
        </PlatformCell>
        <PlatformCell label={dateLabel}>
          <span className="truncate tabular-nums" title={date}>
            {date}
          </span>
        </PlatformCell>
        {tab === 'approved' && (
          <PlatformCell label="Estado">
            {state && (
              <Badge variant={state.variant} className="self-start">
                {state.label}
              </Badge>
            )}
          </PlatformCell>
        )}
        {/* Sin acciones, la celda queda vacía y la columna conserva su ancho. */}
        <div className="min-w-0">{actions}</div>
      </div>
      {row.rejectionReason && (
        <p className="bg-muted mx-4 mb-4 rounded-md px-3 py-2 text-xs">
          <span className="text-muted-foreground">Motivo: </span>
          {row.rejectionReason}
        </p>
      )}
      {suspensionReason && (
        <p className="bg-destructive/10 mx-4 mb-4 rounded-md px-3 py-2 text-xs">
          <span className="text-muted-foreground">Motivo de la suspensión: </span>
          {suspensionReason}
        </p>
      )}
    </li>
  );
}
