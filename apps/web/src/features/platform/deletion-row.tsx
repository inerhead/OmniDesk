import type { PlatformTenantDeletionRow } from '@omnidesk/contracts';
import { Badge } from '@/shared/ui/badge';
import { DELETION_GRID, formatDate, rowGridClass } from './platform-columns';
import { PlatformCell } from './platform-table';

/** Constancia de una empresa borrada o en borrado (SPEC 20), en las columnas de SPEC 21. Sin acciones. */
export function DeletionRow({ row }: { row: PlatformTenantDeletionRow }) {
  const done = row.completedAt !== null;
  const counts = [
    `${row.membersDeleted} miembros`,
    `${row.usersDeleted} cuentas`,
    `${row.conversationsDeleted} conversaciones`,
    `${row.messagesDeleted} mensajes`,
    `${row.attachmentsDeleted} archivos`,
  ].join(' · ');
  const requestedAt = formatDate(row.requestedAt);

  return (
    <li className={rowGridClass(DELETION_GRID)}>
      <PlatformCell>
        <span className="truncate font-medium" title={row.tenantName}>
          {row.tenantName}
        </span>
        <span className="text-muted-foreground truncate text-xs" title={row.tenantSlug}>
          {row.tenantSlug}
        </span>
      </PlatformCell>
      <PlatformCell label="Borrada por">
        <span className="truncate" title={row.requestedByEmail}>
          {row.requestedByEmail}
        </span>
      </PlatformCell>
      <PlatformCell label="Pedida el">
        <span className="truncate tabular-nums" title={requestedAt}>
          {requestedAt}
        </span>
      </PlatformCell>
      <PlatformCell label="Estado">
        <Badge variant={done ? 'secondary' : 'destructive'} className="self-start">
          {done ? `Borrada el ${formatDate(row.completedAt)}` : 'Borrando…'}
        </Badge>
      </PlatformCell>
      <PlatformCell label="Conteos">
        <span className="text-muted-foreground text-xs tabular-nums">{counts}</span>
      </PlatformCell>
    </li>
  );
}
