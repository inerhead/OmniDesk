import { Bell, LogOut, Monitor, Moon, Sun, UserRound } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { cn } from '@/shared/lib/utils';
import { ConnectionDot } from '@/shared/realtime/connection-badge';
import { CONNECTION_LABEL, useConnectionStatus } from '@/shared/realtime/connection-status';
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
import { useLogout } from '../api/use-session-actions';
import { SettingsMenuItems, TenantMenuItems } from './account-menu-items';

/**
 * Perfil: avatar con el estado de conexión en la esquina (resaltado en `/settings/*`). Su menú reúne, en este orden, la cuenta, la
 * empresa (cambiar o crear), los ajustes de la empresa activa (Owner y Admin), mi perfil, las notificaciones, el tema y cerrar
 * sesión.
 */
export function UserMenu({ variant }: { variant: 'rail' | 'bar' }) {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const logout = useLogout();
  const theme = useThemePref();
  const connection = CONNECTION_LABEL[useConnectionStatus()];
  const inSettings = useLocation().pathname.startsWith('/settings');
  if (!me) return null;

  const side = variant === 'rail' ? 'right' : 'top';
  const membership = activeMembership(me);
  const label = [me.user.displayName, membership?.tenantName, connection]
    .filter(Boolean)
    .join(' · ');

  return (
    <DropdownMenu>
      <span className="relative flex">
        <Tooltip content={label} side={side}>
          <DropdownMenuTrigger
            aria-label={`Menú de usuario: ${me.user.displayName}`}
            className={cn(
              'focus-visible:ring-ring/50 flex size-10 cursor-pointer items-center justify-center transition-colors outline-none focus-visible:ring-[3px]',
              variant === 'bar' ? 'rounded-full' : 'rounded-lg',
              inSettings
                ? variant === 'bar'
                  ? 'bg-muted'
                  : 'bg-primary/12 dark:bg-primary/20'
                : 'hover:bg-accent data-[state=open]:bg-accent',
            )}
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
        <ConnectionDot
          className={cn(
            'absolute right-0.5 bottom-0.5 ring-2',
            variant === 'bar' ? 'ring-background' : 'ring-sidebar',
          )}
        />
      </span>
      <DropdownMenuContent side={side} align="end" className="w-72">
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

        <TenantMenuItems me={me} />
        {membership && isManagerRole(membership.role) && (
          <>
            <DropdownMenuSeparator />
            <SettingsMenuItems tenantName={membership.tenantName} />
          </>
        )}
        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => void navigate('/settings/profile')}>
          <UserRound aria-hidden />
          Mi perfil
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void navigate('/settings/notifications')}>
          <Bell aria-hidden />
          Notificaciones
        </DropdownMenuItem>
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
