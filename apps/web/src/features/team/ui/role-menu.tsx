import type { MemberRole } from '@omnidesk/contracts';
import { ChevronDown } from 'lucide-react';
import { ROLE_LABEL } from '@/features/auth/model/role-label';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';

const ROLES: MemberRole[] = ['OWNER', 'ADMIN', 'AGENT'];

const ROLE_DESCRIPTION: Record<MemberRole, string> = {
  OWNER: 'Todo, incluida la empresa',
  ADMIN: 'Miembros, canales y todas las conversaciones',
  AGENT: 'Atiende sus conversaciones',
};

/** Rol de un miembro: menú con la descripción de cada rol si se puede cambiar; si no, insignia. */
export function RoleMenu({
  memberName,
  role,
  editable,
  disabled,
  onChange,
}: {
  memberName: string;
  role: MemberRole;
  editable: boolean;
  disabled: boolean;
  onChange: (role: MemberRole) => void;
}) {
  if (!editable) {
    return <Badge variant="outline">{ROLE_LABEL[role]}</Badge>;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Rol de ${memberName}: ${ROLE_LABEL[role]}`}
          className="w-full justify-between"
        >
          {ROLE_LABEL[role]}
          <ChevronDown aria-hidden className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuRadioGroup
          value={role}
          onValueChange={(next) => {
            if (next !== role) onChange(next as MemberRole);
          }}
        >
          {ROLES.map((option) => (
            <DropdownMenuRadioItem key={option} value={option} className="items-start py-2">
              <span className="flex flex-col">
                <span className="font-medium">{ROLE_LABEL[option]}</span>
                <span className="text-muted-foreground text-xs">{ROLE_DESCRIPTION[option]}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
