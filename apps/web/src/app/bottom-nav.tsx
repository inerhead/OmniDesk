import { NavLink } from 'react-router';
import { ActorSelector } from '@/features/actor/ui/actor-selector';
import { cn } from '@/shared/lib/utils';
import { InstallPrompt } from '@/shared/pwa/install-prompt';
import { ConnectionBadge } from '@/shared/realtime/connection-badge';
import { ThemeMenu } from '@/shared/theme/theme-menu';
import { NAV_ITEMS } from './nav-items';

/** Barra inferior en móvil (< md), con los mismos destinos que el rail. */
export function BottomNav() {
  return (
    <nav
      aria-label="Principal"
      className="bg-sidebar text-sidebar-foreground flex shrink-0 items-center justify-around border-t px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] md:hidden"
    >
      {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              'focus-visible:ring-ring/50 flex min-w-16 flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[11px] font-medium outline-none focus-visible:ring-[3px]',
              isActive ? 'text-primary' : 'hover:text-foreground',
            )
          }
        >
          <Icon className="size-5" aria-hidden />
          {label}
        </NavLink>
      ))}
      <ConnectionBadge side="top" />
      <ThemeMenu side="top" />
      <InstallPrompt side="top" />
      <ActorSelector side="top" />
    </nav>
  );
}
