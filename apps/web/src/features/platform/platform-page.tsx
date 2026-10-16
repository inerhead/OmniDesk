import type { PlatformTenantRow, PlatformTenantStatus } from '@omnidesk/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, LogOut, Plus, Trash2, X } from 'lucide-react';
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
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { EmptyState } from '@/shared/ui/empty-state';
import { PageHeader } from '@/shared/ui/page-header';
import { SegmentedControl } from '@/shared/ui/segmented-control';
import { Skeleton } from '@/shared/ui/skeleton';
import { DeleteTenantDialog } from './delete-tenant-dialog';
import { DeletionRow } from './deletion-row';
import {
  approveTenant,
  deleteTenant,
  fetchPlatformTenants,
  fetchTenantDeletions,
  PLATFORM_QUERY_KEY,
  rejectTenant,
  suspendTenant,
  unsuspendTenant,
} from './platform-api';
import { PlatformRow } from './platform-row';
import type { PlatformRowHandlers } from './platform-actions';
import { PlatformRowActions } from './platform-row-actions';
import { DELETION_COLUMNS, DELETION_GRID, TENANT_GRID, tenantColumns } from './platform-columns';
import { PlatformTable } from './platform-table';
import { RejectDialog } from './reject-dialog';
import { SuspendDialog } from './suspend-dialog';
import { deletionErrorMessage } from './tenant-deletion';

/** Pestañas de `/platform`: las tres de SPEC 18 y "Borradas" (SPEC 20). */
type PlatformTab = PlatformTenantStatus | 'deleted';

const TABS: { value: PlatformTab; label: string; empty: string }[] = [
  { value: 'pending', label: 'Pendientes', empty: 'No hay solicitudes pendientes' },
  { value: 'approved', label: 'Aprobadas', empty: 'No hay empresas aprobadas' },
  { value: 'rejected', label: 'Rechazadas', empty: 'No hay rechazos en los últimos 20 días' },
  { value: 'deleted', label: 'Borradas', empty: 'No hay empresas borradas' },
];

/** Mientras alguna empresa se está borrando, la pestaña se refresca sola. */
const DELETING_REFETCH_MS = 5_000;

function parseTab(value: string | null): PlatformTab {
  return value === 'approved' || value === 'rejected' || value === 'deleted' ? value : 'pending';
}

function errorNotice(error: unknown): string {
  if (error instanceof ApiCodeError && error.code === 'NOT_PENDING')
    return 'Esa solicitud ya no está en revisión: otro admin la resolvió.';
  if (error instanceof ApiCodeError && error.code === 'NOT_APPROVED')
    return 'Esa empresa no está aprobada.';
  if (error instanceof ApiCodeError && error.code === 'TENANT_DELETING')
    return 'Esa empresa se está borrando.';
  return 'No se pudo completar la acción. Inténtalo de nuevo.';
}

/**
 * `/platform` (solo admins de plataforma, SPEC 18 y 20): pestañas Pendientes, Aprobadas, Rechazadas
 * y Borradas (la activa en `?tab=`). Aprobar o rechazar solicitudes, suspender o levantar la
 * suspensión de una empresa aprobada, y borrar una suspendida. No necesita empresa activa.
 * Cada pestaña es una tabla con columnas fijas (SPEC 21).
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
  const [deleting, setDeleting] = useState<PlatformTenantRow | null>(null);
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
  const deletions = useQuery({
    queryKey: [...PLATFORM_QUERY_KEY, 'deleted'],
    queryFn: fetchTenantDeletions,
    enabled: isAdmin,
    refetchInterval: (query) =>
      query.state.data?.some((row) => row.completedAt === null) ? DELETING_REFETCH_MS : false,
  });

  // Tras cada acción: las pestañas y el contador de `/me`.
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
  // El error del borrado se queda en su diálogo; al terminar bien, el diálogo se cierra.
  const remove = useMutation({
    mutationFn: ({ id, confirmSlug }: { id: string; confirmSlug: string }) =>
      deleteTenant(id, confirmSlug),
    onSuccess: () => setDeleting(null),
    onSettled: () => queryClient.invalidateQueries({ queryKey: PLATFORM_QUERY_KEY }),
  });
  const pending =
    approve.isPending ||
    reject.isPending ||
    suspend.isPending ||
    unsuspend.isPending ||
    remove.isPending;

  if (!me) return null;
  if (!isAdmin) return <Navigate to="/conversations" replace />;

  const current = tab === 'deleted' ? deletions : lists[tab];
  const count = (value: PlatformTab) =>
    (value === 'deleted' ? deletions : lists[value]).data?.length;
  const rows = tab === 'deleted' ? [] : (lists[tab].data ?? []);
  const deletedRows = deletions.data ?? [];
  const isEmpty = tab === 'deleted' ? deletedRows.length === 0 : rows.length === 0;
  const emptyLabel = TABS.find((item) => item.value === tab)!.empty;
  const handlers: PlatformRowHandlers = {
    onApprove: (row) => approve.mutate(row.id),
    onReject: setRejecting,
    onSuspend: setSuspending,
    onUnsuspend: setUnsuspending,
    onDelete: (row) => {
      remove.reset();
      setDeleting(row);
    },
  };

  return (
    <PlatformShell>
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 md:px-8 md:py-10">
        <PageHeader
          title="Plataforma"
          description="Empresas que piden el alta en OmniDesk, suspendidas y borradas."
        />

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
          className="sm:w-[32rem]"
          renderOption={(option, { className, active }) => {
            const total = count(option.value);
            return (
              <Link
                key={option.value}
                to={{ pathname, search: option.value === 'pending' ? '' : `?tab=${option.value}` }}
                replace
                aria-current={active ? 'page' : undefined}
                className={cn(className, 'inline-flex items-center justify-center gap-1.5')}
              >
                {option.label}
                {total !== undefined && (
                  <span className="text-muted-foreground text-xs tabular-nums">({total})</span>
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
        ) : isEmpty ? (
          <Card className="py-0">
            <EmptyState icon={tab === 'deleted' ? Trash2 : Building2} title={emptyLabel} />
          </Card>
        ) : tab === 'deleted' ? (
          <PlatformTable columns={DELETION_COLUMNS} grid={DELETION_GRID}>
            {deletedRows.map((row) => (
              <DeletionRow key={row.id} row={row} />
            ))}
          </PlatformTable>
        ) : (
          <PlatformTable columns={tenantColumns(tab)} grid={TENANT_GRID[tab]}>
            {rows.map((row) => (
              <PlatformRow
                key={row.id}
                row={row}
                tab={tab}
                actions={
                  <PlatformRowActions row={row} tab={tab} pending={pending} handlers={handlers} />
                }
              />
            ))}
          </PlatformTable>
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
        <DeleteTenantDialog
          tenant={deleting}
          pending={remove.isPending}
          error={remove.isError ? deletionErrorMessage(remove.error) : null}
          onClose={() => setDeleting(null)}
          onConfirm={(confirmSlug) => {
            if (!deleting) return;
            remove.mutate({ id: deleting.id, confirmSlug });
          }}
        />
      </section>
    </PlatformShell>
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
