import { Building2 } from 'lucide-react';
import { useLocation } from 'react-router';
import { avatarColor, initials } from '@/shared/lib/avatar';
import { cn } from '@/shared/lib/utils';
import { AVATAR_COLOR_CLASS } from '@/shared/ui/avatar-colors';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Tooltip } from '@/shared/ui/tooltip';
import { activeMembership, isManagerRole, useMe } from '../api/use-me';
import { ROLE_LABEL } from '../model/role-label';
import { SettingsMenuItems, TenantMenuItems } from './account-menu-items';

/**
 * Empresa en el rail: la activa, el cambio de empresa y sus ajustes (Owner y Admin). Se marca activo
 * en `/settings/*`.
 */
export function CompanyMenu() {
  const { data: me } = useMe();
  const { pathname } = useLocation();
  const membership = activeMembership(me);
  if (!me || !membership) return null;

  const active = pathname.startsWith('/settings');
  const label = `Empresa: ${membership.tenantName}`;
  return (
    <DropdownMenu>
      <Tooltip content={label} side="right">
        <DropdownMenuTrigger
          aria-label={label}
          className={cn(
            'focus-visible:ring-ring/50 flex size-10 items-center justify-center rounded-lg transition-colors outline-none focus-visible:ring-[3px]',
            active
              ? 'bg-primary/12 text-primary dark:bg-primary/20'
              : 'hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent',
          )}
        >
          <Building2 className="size-5" aria-hidden />
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent side="right" align="end" className="w-64">
        <div className="flex items-center gap-3 px-2 py-2">
          <span
            aria-hidden
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold',
              AVATAR_COLOR_CLASS[avatarColor(membership.tenantId)],
            )}
          >
            {initials(membership.tenantName, '?')}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{membership.tenantName}</span>
            <span className="text-muted-foreground truncate text-xs">
              Empresa actual · {ROLE_LABEL[membership.role]}
            </span>
          </div>
        </div>
        {isManagerRole(membership.role) && (
          <>
            <DropdownMenuSeparator />
            <SettingsMenuItems />
          </>
        )}
        <DropdownMenuSeparator />
        <TenantMenuItems me={me} label="Cambiar de empresa" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
