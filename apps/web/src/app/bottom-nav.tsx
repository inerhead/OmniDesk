import { NavLink } from 'react-router';
import { UserMenu } from '@/features/auth/ui/user-menu';
import { useNewMessageSignal } from '@/features/conversations/model/new-message-signal';
import { cn } from '@/shared/lib/utils';
import { InstallPrompt } from '@/shared/pwa/install-prompt';
import { NavItemIcon } from './nav-item-icon';
import { navItemLabel } from './nav-item-label';
import { NAV_ITEMS } from './nav-items';

/** Barra inferior en móvil (< md): pastilla flotante, como la de WhatsApp. */
export function BottomNav() {
  const signal = useNewMessageSignal();
  return (
    <nav aria-label="Principal" className="shrink-0 px-3 pt-2 pb-[var(--safe-bottom)] md:hidden">
      <div className="bg-background text-foreground flex h-[4.25rem] items-center justify-around rounded-full border px-1.5 shadow-[0_8px_28px_rgba(0,0,0,0.12)] dark:border-white/10 dark:shadow-[0_8px_28px_rgba(0,0,0,0.45)]">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            aria-label={navItemLabel(item, signal)}
            className={({ isActive }) =>
              cn(
                'focus-visible:ring-ring/50 flex min-w-16 flex-col items-center gap-0.5 rounded-full px-3 py-1.5 text-[10px] font-medium outline-none focus-visible:ring-[3px]',
                // `--nav-icon-bg`: el fondo opaco del botón, para los iconos que tapan un trazo.
                isActive
                  ? 'bg-muted text-foreground [--nav-icon-bg:var(--muted)]'
                  : 'text-muted-foreground [--nav-icon-bg:var(--background)]',
              )
            }
          >
            <NavItemIcon item={item} className="size-6" />
            {item.label}
          </NavLink>
        ))}
        <InstallPrompt side="top" />
        <UserMenu variant="bar" />
      </div>
    </nav>
  );
}
