import { NavLink } from 'react-router';
import { ChannelSwitcher } from '@/features/conversations/ui/channel-switcher';
import { UserMenu } from '@/features/auth/ui/user-menu';
import { cn } from '@/shared/lib/utils';
import { InstallPrompt } from '@/shared/pwa/install-prompt';
import { Tooltip } from '@/shared/ui/tooltip';
import { NAV_ITEMS } from './nav-items';
import { publicAsset } from '@/shared/config/env';

/** Rail vertical de 64 px (≥ md): navegación y canales arriba; instalar y perfil abajo. */
export function NavRail() {
  return (
    <nav
      aria-label="Principal"
      className="bg-sidebar text-sidebar-foreground hidden w-16 shrink-0 flex-col items-center gap-2 border-r py-3 md:flex"
    >
      <img src={publicAsset('logo.svg')} alt="OmniDesk" className="mb-2 size-8" />
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <Tooltip key={to} content={label} side="right">
            <NavLink
              to={to}
              aria-label={label}
              className={({ isActive }) =>
                cn(
                  'focus-visible:ring-ring/50 flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors outline-none focus-visible:ring-[3px]',
                  isActive
                    ? 'bg-primary/12 text-primary dark:bg-primary/20'
                    : 'hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              <Icon className="size-5" aria-hidden />
            </NavLink>
          </Tooltip>
        ))}
        <ChannelSwitcher variant="rail" />
      </div>
      <div className="mt-auto flex w-full flex-col items-center gap-2 border-t pt-3">
        <InstallPrompt />
        <UserMenu variant="rail" />
      </div>
    </nav>
  );
}
