import type { PlatformTenantRow } from '@omnidesk/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Skeleton } from '@/shared/ui/skeleton';
import { fetchTenantDeletionPreview, PLATFORM_QUERY_KEY } from './platform-api';
import { confirmsTenantDeletion, deletionSummary } from './tenant-deletion';

/**
 * Borrar una empresa suspendida (SPEC 20): muestra lo que se borra y exige escribir su slug exacto.
 * Es irreversible; el borrado sigue en segundo plano.
 */
export function DeleteTenantDialog({
  tenant,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  tenant: PlatformTenantRow | null;
  pending: boolean;
  error: string | null;
  onConfirm: (confirmSlug: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={tenant !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent>
        {tenant && (
          <DeleteTenantForm
            key={tenant.id}
            tenant={tenant}
            pending={pending}
            error={error}
            onConfirm={onConfirm}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeleteTenantForm({
  tenant,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  tenant: PlatformTenantRow;
  pending: boolean;
  error: string | null;
  onConfirm: (confirmSlug: string) => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const preview = useQuery({
    queryKey: [...PLATFORM_QUERY_KEY, 'deletion-preview', tenant.id],
    queryFn: () => fetchTenantDeletionPreview(tenant.id),
    // Los conteos cambian mientras el diálogo está cerrado: siempre los pide de nuevo.
    staleTime: 0,
    gcTime: 0,
  });
  const matches = confirmsTenantDeletion(typed, tenant.slug);

  return (
    <>
      <DialogTitle className="pr-6">Borrar {tenant.name}</DialogTitle>
      <DialogDescription asChild>
        <div className="flex flex-col gap-2">
          <p>
            Se borran para siempre sus conversaciones, contactos, canales, archivos y miembros. Las
            cuentas que no pertenecen a otra empresa también se borran.
          </p>
          {preview.isPending ? (
            <div className="flex flex-col gap-1.5" aria-busy="true">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : preview.isError ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-destructive">No se pudo calcular qué se borrará.</span>
              <Button size="sm" variant="outline" onClick={() => void preview.refetch()}>
                Reintentar
              </Button>
            </div>
          ) : (
            <p className="text-foreground font-medium">{deletionSummary(preview.data)}</p>
          )}
        </div>
      </DialogDescription>
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (matches && preview.isSuccess) onConfirm(typed);
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span>
            Escribe <strong className="font-mono">{tenant.slug}</strong> para confirmar
          </span>
          <Input
            value={typed}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={pending}
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={pending || !matches || !preview.isSuccess}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending ? 'Borrando…' : 'Borrar empresa'}
          </Button>
        </div>
      </form>
    </>
  );
}
