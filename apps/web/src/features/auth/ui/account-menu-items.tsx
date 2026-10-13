import type { MeResponse } from '@omnidesk/contracts';
import { MessageSquare, Plus, Users } from 'lucide-react';
import { useNavigate } from 'react-router';
import { avatarColor, initials } from '@/shared/lib/avatar';
import { cn } from '@/shared/lib/utils';
import { AVATAR_COLOR_CLASS } from '@/shared/ui/avatar-colors';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/shared/ui/dropdown-menu';
import { useSwitchTenant } from '../api/use-session-actions';
import { ROLE_LABEL } from '../model/role-label';

/** Empresas del usuario (la activa marcada) y «Crear empresa». */
export function TenantMenuItems({ me, label = 'Empresa' }: { me: MeResponse; label?: string }) {
  const navigate = useNavigate();
  const switchTenant = useSwitchTenant();
  return (
    <>
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={me.activeTenantId ?? ''}
        onValueChange={(tenantId) => {
          if (tenantId !== me.activeTenantId) switchTenant.mutate(tenantId);
        }}
      >
        {me.memberships.map((item) => {
          const current = item.tenantId === me.activeTenantId;
          return (
            <DropdownMenuRadioItem
              key={item.tenantId}
              value={item.tenantId}
              indicator="pulse"
              disabled={switchTenant.isPending}
              className={cn('gap-3 py-2', current && 'bg-primary/10 dark:bg-primary/15')}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold',
                  AVATAR_COLOR_CLASS[avatarColor(item.tenantId)],
                  current && 'ring-primary ring-2',
                )}
              >
                {initials(item.tenantName, '?')}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn('truncate', current && 'text-primary font-semibold')}>
                  {item.tenantName}
                </span>
                <span className="text-muted-foreground text-xs">
                  {ROLE_LABEL[item.role]}
                  {current && ' · Actual'}
                </span>
              </span>
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
      <DropdownMenuItem onSelect={() => void navigate('/onboarding')}>
        <Plus aria-hidden />
        Crear empresa
      </DropdownMenuItem>
    </>
  );
}

/** Ajustes de la empresa: solo para Owner y Admin. */
export function SettingsMenuItems() {
  const navigate = useNavigate();
  return (
    <>
      <DropdownMenuLabel>Ajustes</DropdownMenuLabel>
      <DropdownMenuItem onSelect={() => void navigate('/settings/members')}>
        <Users aria-hidden />
        Miembros
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void navigate('/settings/channels')}>
        <MessageSquare aria-hidden />
        Canales
      </DropdownMenuItem>
    </>
  );
}
