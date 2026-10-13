import { LogOut, Monitor, Moon, Sun } from 'lucide-react';
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
 * Avatar del usuario con el estado de conexión en la esquina; abre tema y cerrar sesión. En el rail,
 * empresa y ajustes tienen su propio botón; en la barra móvil van dentro de este menú.
 */
export function UserMenu({ variant }: { variant: 'rail' | 'bar' }) {
  const { data: me } = useMe();
  const logout = useLogout();
  const theme = useThemePref();
  const connection = CONNECTION_LABEL[useConnectionStatus()];
  if (!me) return null;

  const side = variant === 'rail' ? 'right' : 'top';
  const membership = activeMembership(me);
  const label = `${me.user.displayName} · ${connection}`;

  return (
    <DropdownMenu>
      <span className="relative flex">
        <Tooltip content={label} side={side}>
          <DropdownMenuTrigger
            aria-label={`Menú de usuario: ${me.user.displayName}`}
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
        <ConnectionDot className="ring-sidebar absolute -right-0.5 -bottom-0.5 ring-2" />
      </span>
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

        {variant === 'bar' && (
          <>
            <TenantMenuItems me={me} />
            <DropdownMenuSeparator />
            {membership && isManagerRole(membership.role) && (
              <>
                <SettingsMenuItems />
                <DropdownMenuSeparator />
              </>
            )}
          </>
        )}

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
