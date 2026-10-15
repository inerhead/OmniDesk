import type { PlatformTenantRow } from '@omnidesk/contracts';
import { ReasonDialog } from './reason-dialog';

/** Suspender una empresa aprobada: nadie entra, ni su Owner (SPEC 18). */
export function SuspendDialog({
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
      title={tenant ? `Suspender ${tenant.name}` : 'Suspender empresa'}
      description="Nadie podrá entrar, tampoco el Owner, y no saldrá ningún mensaje. Los mensajes de WhatsApp se siguen guardando. Sus miembros verán el motivo."
      confirmLabel="Suspender"
      placeholder="Por ejemplo: impago de la suscripción."
      pending={pending}
      onConfirm={onConfirm}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    />
  );
}
