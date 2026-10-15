import { NavLink } from 'react-router';
import { activeMembership, useMe } from '@/features/auth/api/use-me';
import { ChannelSwitcher } from '@/features/conversations/ui/channel-switcher';
import { UserMenu } from '@/features/auth/ui/user-menu';
import { cn } from '@/shared/lib/utils';
import { InstallPrompt } from '@/shared/pwa/install-prompt';
import { TenantMark } from '@/shared/ui/tenant-mark';
import { Tooltip } from '@/shared/ui/tooltip';
import { NAV_ITEMS } from './nav-items';
import { publicAsset } from '@/shared/config/env';

/** Cabecera del rail: la marca de la empresa activa (SPEC 16); sin empresa, la de OmniDesk. */
function RailBrand() {
  const membership = activeMembership(useMe().data);
  if (!membership) {
    return <img src={publicAsset('logo.svg')} alt="OmniDesk" className="mb-2 size-8" />;
  }
  return (
    <Tooltip content={membership.tenantName} side="right">
      <span className="mb-2 flex" aria-label={membership.tenantName} role="img">
        <TenantMark
          id={membership.tenantId}
          name={membership.tenantName}
          logoUrl={membership.tenantLogoUrl}
        />
      </span>
    </Tooltip>
  );
}

/** Rail vertical de 64 px (≥ md): navegación y canales arriba; instalar y perfil abajo. */
export function NavRail() {
  return (
    <nav
      aria-label="Principal"
      className="bg-sidebar text-sidebar-foreground hidden w-16 shrink-0 flex-col items-center gap-2 border-r py-3 md:flex"
    >
      <RailBrand />
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <Tooltip key={to} content={label} side="right">
            <NavLink
              to={to}
              aria-label={label}
              className={({ isActive }) =>
                cn(
                  'focus-visible:ring-ring/50 flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors outline-none focus-visible:ring-[3px]',
                  // `--nav-icon-bg`: el fondo opaco del botón, para los iconos que tapan un trazo.
                  isActive
                    ? 'bg-primary/12 text-primary dark:bg-primary/20 [--nav-icon-bg:color-mix(in_oklch,var(--sidebar),var(--primary)_12%)] dark:[--nav-icon-bg:color-mix(in_oklch,var(--sidebar),var(--primary)_20%)]'
                    : 'hover:bg-accent hover:text-accent-foreground [--nav-icon-bg:var(--sidebar)] hover:[--nav-icon-bg:var(--accent)]',
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
