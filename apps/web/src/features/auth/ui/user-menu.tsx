import { MessageSquare, LogOut, Monitor, Moon, Plus, Sun, Users } from 'lucide-react';
import { useNavigate } from 'react-router';
import { setThemePref, parseThemePref, useThemePref } from '@/shared/theme/theme-store';
import { Avatar } from '@/shared/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Tooltip } from '@/shared/ui/tooltip';
import { activeMembership, isManagerRole, useMe } from '../api/use-me';
import { useLogout, useSwitchTenant } from '../api/use-session-actions';

const ROLE_LABEL = { OWNER: 'Owner', ADMIN: 'Admin', AGENT: 'Agente' } as const;

/** Menú de usuario del rail: empresa activa, tema, miembros y cerrar sesión. */
export function UserMenu({ side = 'right' }: { side?: 'right' | 'top' }) {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const switchTenant = useSwitchTenant();
  const logout = useLogout();
  const theme = useThemePref();
  if (!me) return null;

  const membership = activeMembership(me);
  const label = membership
    ? `${me.user.displayName} · ${membership.tenantName}`
    : me.user.displayName;

  return (
    <DropdownMenu>
      <Tooltip content={label} side={side}>
        <DropdownMenuTrigger
          aria-label={`Menú de usuario: ${label}`}
          className="focus-visible:ring-ring/50 rounded-full outline-none focus-visible:ring-[3px]"
        >
          <Avatar
            id={me.user.id}
            name={me.user.displayName}
            fallback={me.user.email}
            imageUrl={me.user.avatarUrl}
            size="sm"
          />
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent side={side} align="end" className="w-64">
        <div className="flex items-center gap-3 px-2 py-2">
          <Avatar
            id={me.user.id}
            name={me.user.displayName}
            fallback={me.user.email}
            imageUrl={me.user.avatarUrl}
          />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{me.user.displayName}</span>
            <span className="text-muted-foreground truncate text-xs">{me.user.email}</span>
          </div>
        </div>
        <DropdownMenuSeparator />

        <DropdownMenuLabel>Empresa</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={me.activeTenantId ?? ''}
          onValueChange={(tenantId) => {
            if (tenantId !== me.activeTenantId) switchTenant.mutate(tenantId);
          }}
        >
          {me.memberships.map((item) => (
            <DropdownMenuRadioItem
              key={item.tenantId}
              value={item.tenantId}
              disabled={switchTenant.isPending}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{item.tenantName}</span>
                <span className="text-muted-foreground text-xs">{ROLE_LABEL[item.role]}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuItem onSelect={() => void navigate('/onboarding')}>
          <Plus aria-hidden />
          Crear empresa
        </DropdownMenuItem>
        {membership && isManagerRole(membership.role) && (
          <DropdownMenuItem onSelect={() => void navigate('/settings/members')}>
            <Users aria-hidden />
            Miembros
          </DropdownMenuItem>
        )}
        {membership && isManagerRole(membership.role) && (
          <DropdownMenuItem onSelect={() => void navigate('/settings/channels')}>
            <MessageSquare aria-hidden />
            Canales
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />

        <DropdownMenuLabel>Tema</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => setThemePref(parseThemePref(value))}
        >
          <DropdownMenuRadioItem value="light">
            <Sun aria-hidden />
            Claro
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon aria-hidden />
            Oscuro
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor aria-hidden />
            Sistema
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => logout.mutate()} disabled={logout.isPending}>
          <LogOut aria-hidden />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
