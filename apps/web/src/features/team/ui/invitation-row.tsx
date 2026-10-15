import type { Invitation } from '@omnidesk/contracts';
import { Mail } from 'lucide-react';
import { ROLE_LABEL } from '@/features/auth/model/role-label';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });

/**
 * Mismas columnas que los miembros (persona y rol alineados); la de acciones se ajusta a "Revocar".
 * En móvil se apila igual: email y "Revocar" arriba, rol debajo.
 */
const INVITATION_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_9.5rem_auto]';

export function InvitationRow({
  invitation,
  canRevoke,
  pending,
  onRevoke,
}: {
  invitation: Invitation;
  canRevoke: boolean;
  pending: boolean;
  onRevoke: () => void;
}) {
  return (
    <li className={`${INVITATION_GRID} px-4 py-3`}>
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full"
        >
          <Mail className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{invitation.email}</span>
          <span className="text-muted-foreground truncate text-xs">
            Invitó {invitation.invitedBy.displayName} · vence el{' '}
            {dateFormat.format(new Date(invitation.expiresAt))}
          </span>
        </div>
      </div>
      <div className="col-start-1 row-start-2 flex sm:col-start-auto sm:row-start-auto">
        <Badge variant="outline">{ROLE_LABEL[invitation.role]}</Badge>
      </div>
      <div className="col-start-2 row-start-1 flex justify-end sm:col-start-auto sm:row-start-auto">
        {canRevoke && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={onRevoke}>
            Revocar
          </Button>
        )}
      </div>
    </li>
  );
}
