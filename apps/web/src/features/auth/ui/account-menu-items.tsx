import type { MeResponse } from '@omnidesk/contracts';
import { Building2, MessageSquare, Plus, ShieldCheck, Users } from 'lucide-react';
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
import { CREATE_TENANT_PATH, hasPendingRequest, tenantStateLabel } from '../model/tenant-request';
import { canCreateTenant } from '../model/tenant-permissions';

/**
 * Empresas del usuario (la activa marcada, con su estado: inactiva, en revisión o suspendida) y
 * «Crear empresa» si puede (`canCreateTenant`) y no tiene ya una solicitud en revisión (SPEC 18).
 */
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
          const state = tenantStateLabel(item.tenantState);
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
                  {state && ` · ${state}`}
                  {current && ' · Actual'}
                </span>
              </span>
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
      {canCreateTenant(me) && !hasPendingRequest(me) && (
        <DropdownMenuItem onSelect={() => void navigate(CREATE_TENANT_PATH)}>
          <Plus aria-hidden />
          Crear empresa
        </DropdownMenuItem>
      )}
    </>
  );
}

/** «Plataforma» (SPEC 18), solo para admins de plataforma, con las solicitudes pendientes. */
export function PlatformMenuItem({ pendingCount }: { pendingCount: number | null }) {
  const navigate = useNavigate();
  return (
    <DropdownMenuItem onSelect={() => void navigate('/platform')}>
      <ShieldCheck aria-hidden />
      <span className="flex-1">Plataforma</span>
      {pendingCount !== null && pendingCount > 0 && (
        <span
          className="bg-primary text-primary-foreground rounded-full px-1.5 text-xs font-medium tabular-nums"
          aria-label={`${pendingCount} solicitudes pendientes`}
        >
          {pendingCount}
        </span>
      )}
    </DropdownMenuItem>
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
