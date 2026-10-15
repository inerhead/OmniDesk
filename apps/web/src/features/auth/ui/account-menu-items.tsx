import type { MeResponse } from '@omnidesk/contracts';
import { Building2, MessageSquare, Plus, Users } from 'lucide-react';
import { useNavigate } from 'react-router';
import { cn } from '@/shared/lib/utils';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/shared/ui/dropdown-menu';
import { TenantMark } from '@/shared/ui/tenant-mark';
import { useSwitchTenant } from '../api/use-session-actions';
import { ROLE_LABEL } from '../model/role-label';
import { canCreateTenant } from '../model/tenant-permissions';

/** Empresas del usuario (la activa marcada) y «Crear empresa» si puede (`canCreateTenant`). */
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
              <TenantMark
                id={item.tenantId}
                name={item.tenantName}
                logoUrl={item.tenantLogoUrl}
                className={cn(current && 'ring-primary ring-2', !item.tenantActive && 'opacity-60')}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn('truncate', current && 'text-primary font-semibold')}>
                  {item.tenantName}
                </span>
                <span className="text-muted-foreground text-xs">
                  {ROLE_LABEL[item.role]}
                  {!item.tenantActive && ' · Inactiva'}
                  {current && ' · Actual'}
                </span>
              </span>
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
      {canCreateTenant(me) && (
        <DropdownMenuItem onSelect={() => void navigate('/onboarding')}>
          <Plus aria-hidden />
          Crear empresa
        </DropdownMenuItem>
      )}
    </>
  );
}

/** Ajustes de la empresa activa: solo para Owner y Admin; "Empresa", solo para Owner (SPEC 16). */
export function SettingsMenuItems({
  tenantName,
  isOwner,
}: {
  tenantName: string;
  isOwner: boolean;
}) {
  const navigate = useNavigate();
  return (
    <>
      <DropdownMenuLabel className="truncate">Ajustes de {tenantName}</DropdownMenuLabel>
      {isOwner && (
        <DropdownMenuItem onSelect={() => void navigate('/settings/company')}>
          <Building2 aria-hidden />
          Empresa
        </DropdownMenuItem>
      )}
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
