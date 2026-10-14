import { NavLink } from 'react-router';
import { UserMenu } from '@/features/auth/ui/user-menu';
import { cn } from '@/shared/lib/utils';
import { InstallPrompt } from '@/shared/pwa/install-prompt';
import { NAV_ITEMS } from './nav-items';

/** Barra inferior en móvil (< md), con los mismos destinos que el rail. */
export function BottomNav() {
  return (
    <nav
      aria-label="Principal"
      className="bg-sidebar text-sidebar-foreground shrink-0 border-t px-2 pb-[var(--safe-bottom)] md:hidden"
    >
      <div className="flex h-14 items-center justify-around">
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
        <InstallPrompt side="top" />
        <UserMenu variant="bar" />
      </div>
    </nav>
  );
}
