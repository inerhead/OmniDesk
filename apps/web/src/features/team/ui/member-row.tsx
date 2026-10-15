import type { Member, MemberRole } from '@omnidesk/contracts';
import { MoreHorizontal, UserMinus } from 'lucide-react';
import { Avatar } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { RoleMenu } from './role-menu';

/**
 * Columnas fijas, iguales en todas las filas: persona (avatar, nombre, email), rol y acciones. La de
 * acciones conserva su ancho aunque esté vacía. En móvil la fila se apila: la persona y "⋯" arriba,
 * el rol debajo.
 */
const MEMBER_GRID =
  'grid grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_9.5rem_2.25rem]';

export function MemberRow({
  member,
  isSelf,
  canChangeRole,
  canRemove,
  pending,
  onChangeRole,
  onRemove,
}: {
  member: Member;
  isSelf: boolean;
  canChangeRole: boolean;
  canRemove: boolean;
  pending: boolean;
  onChangeRole: (role: MemberRole) => void;
  onRemove: () => void;
}) {
  return (
    <li className={`${MEMBER_GRID} px-4 py-3`}>
      <div className="flex min-w-0 items-center gap-3">
        <Avatar id={member.id} name={member.displayName} fallback="?" imageUrl={member.avatarUrl} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">
            {member.displayName}
            {isSelf && <span className="text-muted-foreground font-normal"> (tú)</span>}
          </span>
          <span className="text-muted-foreground truncate text-xs">{member.email}</span>
        </div>
      </div>

      <div className="col-start-1 row-start-2 flex sm:col-start-auto sm:row-start-auto">
        <RoleMenu
          memberName={member.displayName}
          role={member.role}
          editable={canChangeRole}
          disabled={pending}
          onChange={onChangeRole}
        />
      </div>

      <div className="col-start-2 row-start-1 flex justify-end sm:col-start-auto sm:row-start-auto">
        {canRemove && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={pending}>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Acciones para ${member.displayName}`}
              >
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={onRemove}
              >
                <UserMinus aria-hidden />
                Quitar de la empresa
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  );
}
