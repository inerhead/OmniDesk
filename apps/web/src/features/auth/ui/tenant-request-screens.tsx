import type { Membership, MeResponse } from '@omnidesk/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, Clock } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';
import { TenantMark } from '@/shared/ui/tenant-mark';
import { postDismissTenantRejection } from '../api/auth-api';
import { ME_QUERY_KEY } from '../api/use-me';
import { useMeWhileWaiting } from '../api/use-me-while-waiting';
import { showsRejectionNotice } from '../model/tenant-request';

const dateFormat = new Intl.DateTimeFormat('es', { dateStyle: 'long' });
const formatDate = (iso: string | null) => (iso ? dateFormat.format(new Date(iso)) : null);

/** "Solicitud en revisión": la empresa, su identificador y cuándo se pidió. */
export function PendingRequestBody({ membership }: { membership: Membership }) {
  useMeWhileWaiting();
  const sentAt = formatDate(membership.requestedAt);
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
        <Clock className="size-5" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Solicitud en revisión</h2>
        <p className="text-sm">
          <span className="font-medium">{membership.tenantName}</span>
          <span className="text-muted-foreground"> · {membership.tenantSlug}</span>
        </p>
        {sentAt && <p className="text-muted-foreground text-sm">Enviada el {sentAt}.</p>}
      </div>
      <p className="text-muted-foreground text-sm">
        La plataforma revisa cada empresa nueva antes de activarla. Esta pantalla se actualiza sola
        cuando haya una respuesta.
      </p>
    </div>
  );
}

/** "Empresa suspendida por la plataforma", con el motivo y la fecha. Sin acciones. */
export function SuspendedTenantBody({ membership }: { membership: Membership }) {
  useMeWhileWaiting();
  const since = formatDate(membership.suspendedAt);
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <TenantMark
        id={membership.tenantId}
        name={membership.tenantName}
        logoUrl={membership.tenantLogoUrl}
        size="md"
        className="opacity-60"
      />
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">
          Empresa suspendida por la plataforma
        </h2>
        <p className="text-muted-foreground text-sm">
          {membership.tenantName}
          {since && ` · desde el ${since}`}
        </p>
      </div>
      {membership.suspensionReason && (
        <p className="bg-muted w-full rounded-md px-3 py-2 text-left text-sm">
          <span className="text-muted-foreground block text-xs">Motivo</span>
          {membership.suspensionReason}
        </p>
      )}
      <p className="text-muted-foreground text-sm">
        Nadie puede usarla mientras dure la suspensión. Los mensajes de WhatsApp se siguen
        guardando.
      </p>
    </div>
  );
}

/** En revisión o suspendida, dentro de la app: el rail sigue para cambiar de empresa. */
export function BlockedTenantScreen({ membership }: { membership: Membership }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4">
      <div className="bg-card text-card-foreground flex w-full max-w-md flex-col rounded-2xl border p-6 shadow-sm sm:p-8">
        {membership.tenantState === 'pending' ? (
          <PendingRequestBody membership={membership} />
        ) : (
          <SuspendedTenantBody membership={membership} />
        )}
      </div>
    </div>
  );
}

/** "Tu solicitud para X fue rechazada", con el motivo y la fecha. */
export function RejectedRequestBody({
  rejection,
}: {
  rejection: NonNullable<MeResponse['tenantRejection']>;
}) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="bg-destructive/10 text-destructive flex size-12 items-center justify-center rounded-full">
        <Ban className="size-5" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">
          Tu solicitud para {rejection.tenantName} fue rechazada
        </h2>
        <p className="text-muted-foreground text-sm">El {formatDate(rejection.rejectedAt)}.</p>
      </div>
      <p className="bg-muted w-full rounded-md px-3 py-2 text-left text-sm">
        <span className="text-muted-foreground block text-xs">Motivo</span>
        {rejection.reason}
      </p>
    </div>
  );
}

/** Con otras empresas, el rechazo se avisa una sola vez dentro de la app, con "Entendido". */
export function RejectionNoticeDialog({ me }: { me: MeResponse | undefined }) {
  const queryClient = useQueryClient();
  const dismiss = useMutation({
    mutationFn: postDismissTenantRejection,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
  });
  const rejection = me?.tenantRejection;
  if (!rejection || !showsRejectionNotice(me)) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !dismiss.isPending) dismiss.mutate();
      }}
    >
      <DialogContent>
        <DialogTitle className="pr-6">Solicitud rechazada</DialogTitle>
        <DialogDescription>
          La plataforma rechazó la empresa {rejection.tenantName} el{' '}
          {formatDate(rejection.rejectedAt)}.
        </DialogDescription>
        <p className="bg-muted rounded-md px-3 py-2 text-sm">
          <span className="text-muted-foreground block text-xs">Motivo</span>
          {rejection.reason}
        </p>
        <div className="flex justify-end">
          <Button type="button" disabled={dismiss.isPending} onClick={() => dismiss.mutate()}>
            Entendido
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
