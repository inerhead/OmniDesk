import type { PlatformTenantRow } from '@omnidesk/contracts';
import { ReasonDialog } from './reason-dialog';

/** Rechazar una solicitud: la empresa se borra y el solicitante ve el motivo (SPEC 18). */
export function RejectDialog({
  tenant,
  pending,
  onConfirm,
  onClose,
}: {
  tenant: PlatformTenantRow | null;
  pending: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  return (
    <ReasonDialog
      key={tenant?.id ?? 'none'}
      open={tenant !== null}
      title={tenant ? `Rechazar ${tenant.name}` : 'Rechazar solicitud'}
      description="La empresa se borra y su identificador queda libre. El solicitante verá el motivo y podrá enviar otra solicitud."
      confirmLabel="Rechazar"
      placeholder="Por ejemplo: no pudimos verificar los datos de contacto."
      pending={pending}
      onConfirm={onConfirm}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    />
  );
}
