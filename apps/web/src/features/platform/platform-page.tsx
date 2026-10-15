import type { PlatformTenantRow, PlatformTenantStatus } from '@omnidesk/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, LogOut, Phone, Plus, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router';
import { ME_QUERY_KEY, useMe } from '@/features/auth/api/use-me';
import { useLogout } from '@/features/auth/api/use-session-actions';
import { CREATE_TENANT_PATH, hasPendingRequest } from '@/features/auth/model/tenant-request';
import { canCreateTenant } from '@/features/auth/model/tenant-permissions';
import { ApiCodeError } from '@/shared/api/api-error';
import { publicAsset } from '@/shared/config/env';
import { cn } from '@/shared/lib/utils';
import { ThemeMenu } from '@/shared/theme/theme-menu';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { EmptyState } from '@/shared/ui/empty-state';
import { SegmentedControl } from '@/shared/ui/segmented-control';
import { Skeleton } from '@/shared/ui/skeleton';
import {
  approveTenant,
  fetchPlatformTenants,
  PLATFORM_QUERY_KEY,
  rejectTenant,
  suspendTenant,
  unsuspendTenant,
} from './platform-api';
import { RejectDialog } from './reject-dialog';
import { SuspendDialog } from './suspend-dialog';

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium' });
const formatDate = (iso: string | null) => (iso ? dateFormat.format(new Date(iso)) : '—');

const TABS: { value: PlatformTenantStatus; label: string; empty: string }[] = [
  { value: 'pending', label: 'Pendientes', empty: 'No hay solicitudes pendientes' },
  { value: 'approved', label: 'Aprobadas', empty: 'No hay empresas aprobadas' },
  { value: 'rejected', label: 'Rechazadas', empty: 'No hay rechazos en los últimos 20 días' },
];

const STATE: Record<
  NonNullable<PlatformTenantRow['state']>,
  { label: string; variant: 'success' | 'secondary' | 'destructive' }
> = {
  active: { label: 'Activa', variant: 'success' },
  inactive: { label: 'Inactiva', variant: 'secondary' },
  suspended: { label: 'Suspendida', variant: 'destructive' },
};

function parseTab(value: string | null): PlatformTenantStatus {
  return value === 'approved' || value === 'rejected' ? value : 'pending';
}

function errorNotice(error: unknown): string {
  if (error instanceof ApiCodeError && error.code === 'NOT_PENDING')
    return 'Esa solicitud ya no está en revisión: otro admin la resolvió.';
  if (error instanceof ApiCodeError && error.code === 'NOT_APPROVED')
    return 'Esa empresa no está aprobada.';
  return 'No se pudo completar la acción. Inténtalo de nuevo.';
}

/**
 * `/platform` (solo admins de plataforma, SPEC 18): pestañas Pendientes, Aprobadas y Rechazadas (la
 * activa en `?tab=`). Aprobar o rechazar solicitudes, y suspender o levantar la suspensión de una
 * empresa aprobada. No necesita empresa activa.
 */
export function PlatformPage() {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const tab = parseTab(searchParams.get('tab'));
  const [notice, setNotice] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PlatformTenantRow | null>(null);
  const [suspending, setSuspending] = useState<PlatformTenantRow | null>(null);
  const [unsuspending, setUnsuspending] = useState<PlatformTenantRow | null>(null);
  const isAdmin = me?.isPlatformAdmin === true;

  const lists = {
    pending: useQuery({
      queryKey: [...PLATFORM_QUERY_KEY, 'pending'],
      queryFn: () => fetchPlatformTenants('pending'),
      enabled: isAdmin,
    }),
    approved: useQuery({
      queryKey: [...PLATFORM_QUERY_KEY, 'approved'],
      queryFn: () => fetchPlatformTenants('approved'),
      enabled: isAdmin,
    }),
    rejected: useQuery({
      queryKey: [...PLATFORM_QUERY_KEY, 'rejected'],
      queryFn: () => fetchPlatformTenants('rejected'),
      enabled: isAdmin,
    }),
  };

  // Tras cada acción: las tres pestañas y el contador de `/me`.
  const onSettled = (_data: unknown, error: Error | null) => {
    setNotice(error ? errorNotice(error) : null);
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: PLATFORM_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
    ]);
  };
  const approve = useMutation({ mutationFn: approveTenant, onSettled });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectTenant(id, reason),
    onSettled,
  });
  const suspend = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => suspendTenant(id, reason),
    onSettled,
  });
  const unsuspend = useMutation({ mutationFn: unsuspendTenant, onSettled });
  const pending = approve.isPending || reject.isPending || suspend.isPending || unsuspend.isPending;

  if (!me) return null;
  if (!isAdmin) return <Navigate to="/conversations" replace />;

  const current = lists[tab];
  const rows = current.data ?? [];
  const emptyLabel = TABS.find((item) => item.value === tab)!.empty;

  return (
    <PlatformShell>
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 md:px-8 md:py-10">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Plataforma</h1>
          <p className="text-muted-foreground text-sm">
            Empresas que piden el alta en OmniDesk y empresas suspendidas.
          </p>
        </header>

        {notice && (
          <div
            role="status"
            className="bg-warning text-warning-foreground flex items-center justify-between gap-2 rounded-md px-4 py-2 text-sm"
          >
            <span>{notice}</span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Cerrar aviso"
              onClick={() => setNotice(null)}
            >
              <X aria-hidden />
            </Button>
          </div>
        )}

        <SegmentedControl
          label="Solicitudes de empresa"
          value={tab}
          options={TABS}
          className="sm:w-96"
          renderOption={(option, { className, active }) => {
            const count = lists[option.value].data?.length;
            return (
              <Link
                key={option.value}
                to={{ pathname, search: option.value === 'pending' ? '' : `?tab=${option.value}` }}
                replace
                aria-current={active ? 'page' : undefined}
                className={cn(className, 'inline-flex items-center justify-center gap-1.5')}
              >
                {option.label}
                {count !== undefined && (
                  <span className="text-muted-foreground text-xs tabular-nums">({count})</span>
                )}
              </Link>
            );
          }}
        />

        {current.isPending ? (
          <Card className="gap-0 py-0" aria-busy="true">
            {[0, 1, 2].map((index) => (
              <div key={index} className="flex items-center gap-3 border-b px-4 py-4 last:border-0">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-64" />
                </div>
              </div>
            ))}
          </Card>
        ) : current.isError ? (
          <Card className="py-0">
            <EmptyState
              title="No se pudo cargar la lista"
              action={
                <Button size="sm" variant="outline" onClick={() => void current.refetch()}>
                  Reintentar
                </Button>
              }
            />
          </Card>
        ) : rows.length === 0 ? (
          <Card className="py-0">
            <EmptyState icon={Building2} title={emptyLabel} />
          </Card>
        ) : (
          <Card className="gap-0 py-0">
            <ul className="divide-y">
              {rows.map((row) => (
                <PlatformRow key={row.id} row={row} tab={tab}>
                  {tab === 'pending' && (
                    <>
                      <Button size="sm" disabled={pending} onClick={() => approve.mutate(row.id)}>
                        Aprobar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => setRejecting(row)}
                      >
                        Rechazar
                      </Button>
                    </>
                  )}
                  {tab === 'approved' &&
                    (row.state === 'suspended' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => setUnsuspending(row)}
                      >
                        Levantar suspensión
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        className="text-destructive"
                        onClick={() => setSuspending(row)}
                      >
                        Suspender
                      </Button>
                    ))}
                </PlatformRow>
              ))}
            </ul>
          </Card>
        )}

        <RejectDialog
          tenant={rejecting}
          pending={reject.isPending}
          onClose={() => setRejecting(null)}
          onConfirm={(reason) => {
            if (!rejecting) return;
            reject.mutate({ id: rejecting.id, reason });
            setRejecting(null);
          }}
        />
        <SuspendDialog
          tenant={suspending}
          pending={suspend.isPending}
          onClose={() => setSuspending(null)}
          onConfirm={(reason) => {
            if (!suspending) return;
            suspend.mutate({ id: suspending.id, reason });
            setSuspending(null);
          }}
        />
        <ConfirmDialog
          open={unsuspending !== null}
          title={unsuspending ? `Levantar la suspensión de ${unsuspending.name}` : 'Levantar'}
          description="Sus miembros vuelven a entrar y se reenvían los mensajes cortados que siguen dentro de la ventana de 18 h."
          confirmLabel="Levantar suspensión"
          pending={unsuspend.isPending}
          onConfirm={() => {
            if (!unsuspending) return;
            unsuspend.mutate(unsuspending.id);
            setUnsuspending(null);
          }}
          onOpenChange={(open) => {
            if (!open) setUnsuspending(null);
          }}
        />
      </section>
    </PlatformShell>
  );
}

/** Una empresa o un rechazo. En móvil se apila: datos arriba, acciones debajo. */
function PlatformRow({
  row,
  tab,
  children,
}: {
  row: PlatformTenantRow;
  tab: PlatformTenantStatus;
  children?: ReactNode;
}) {
  const state = row.state ? STATE[row.state] : null;
  const when =
    tab === 'pending'
      ? `Pedida el ${formatDate(row.requestedAt)}`
      : tab === 'approved'
        ? `Aprobada el ${formatDate(row.approvedAt)}`
        : `Rechazada el ${formatDate(row.rejectedAt)}`;
  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{row.name}</span>
          <span className="text-muted-foreground truncate text-xs">{row.slug}</span>
          {state && <Badge variant={state.variant}>{state.label}</Badge>}
        </div>
        <span className="text-muted-foreground truncate text-xs">
          {tab === 'approved' ? 'Owner' : 'Solicitante'}: {row.requester.displayName}
          {row.requester.email && ` · ${row.requester.email}`}
        </span>
        <span className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
          <span className="inline-flex items-center gap-1">
            <Phone aria-hidden className="size-3" />
            {row.contactPhone ?? 'Sin teléfono'}
          </span>
          <span className="truncate">{row.contactEmail ?? 'Sin email de contacto'}</span>
          <span>{when}</span>
        </span>
        {row.rejectionReason && (
          <p className="bg-muted mt-1 rounded-md px-3 py-2 text-xs">
            <span className="text-muted-foreground">Motivo: </span>
            {row.rejectionReason}
          </p>
        )}
        {row.state === 'suspended' && row.suspensionReason && (
          <p className="bg-destructive/10 mt-1 rounded-md px-3 py-2 text-xs">
            <span className="text-muted-foreground">Motivo de la suspensión: </span>
            {row.suspensionReason}
          </p>
        )}
      </div>
      {children && <div className="flex shrink-0 gap-2">{children}</div>}
    </li>
  );
}

/** Cabecera propia: `/platform` vive fuera de la app de una empresa (puede no haber ninguna). */
function PlatformShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const logout = useLogout();
  const canCreate = me && canCreateTenant(me) && !hasPendingRequest(me);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <img src={publicAsset('logo.svg')} alt="OmniDesk" className="size-7" />
        <span className="flex-1 truncate text-sm font-medium">OmniDesk · Plataforma</span>
        {me?.activeTenantId ? (
          <Button asChild size="sm" variant="ghost">
            <Link to="/conversations">
              <ArrowLeft aria-hidden />
              <span className="hidden sm:inline">Volver a la app</span>
            </Link>
          </Button>
        ) : (
          canCreate && (
            <Button asChild size="sm" variant="ghost">
              <Link to={CREATE_TENANT_PATH}>
                <Plus aria-hidden />
                <span className="hidden sm:inline">Crear empresa</span>
              </Link>
            </Button>
          )
        )}
        <ThemeMenu side="bottom" />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Cerrar sesión"
          onClick={() => logout.mutate()}
        >
          <LogOut aria-hidden />
        </Button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
