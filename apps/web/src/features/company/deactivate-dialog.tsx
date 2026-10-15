import { useState } from 'react';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';

/** Inactivar exige escribir el nombre exacto de la empresa (el API también lo comprueba). */
export function DeactivateDialog({
  open,
  tenantName,
  pending,
  error,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  tenantName: string;
  pending: boolean;
  error: string | null;
  onConfirm: (confirmName: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [confirmName, setConfirmName] = useState('');
  const matches = confirmName.trim() === tenantName.trim();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (!next) setConfirmName('');
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogTitle className="pr-6">Inactivar {tenantName}</DialogTitle>
        <DialogDescription asChild>
          <div className="flex flex-col gap-2">
            <p>Mientras esté inactiva:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Admin y Agent pierden el acceso al momento.</li>
              <li>Los mensajes de WhatsApp se guardan, pero sin IA ni notificaciones.</li>
              <li>No sale ningún mensaje, tampoco los que estaban en cola.</li>
              <li>Las invitaciones pendientes se revocan.</li>
            </ul>
            <p>Podrás reactivarla cuando quieras.</p>
          </div>
        </DialogDescription>
        <label className="flex flex-col gap-1 text-sm">
          <span>
            Escribe <strong>{tenantName}</strong> para confirmar
          </span>
          <Input
            value={confirmName}
            autoComplete="off"
            onChange={(event) => setConfirmName(event.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={pending || !matches}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => onConfirm(confirmName)}
          >
            {pending ? 'Inactivando…' : 'Inactivar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
