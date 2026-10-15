import { useState } from 'react';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';

/** Borrar un contacto exige escribir su teléfono exacto: es irreversible (SPEC 12). */
export function DeleteContactDialog({
  open,
  contactName,
  phone,
  pending,
  error,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  contactName: string;
  phone: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [typed, setTyped] = useState('');
  const matches = typed.trim() === phone;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (!next) setTyped('');
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogTitle className="pr-6">Borrar a {contactName} y su historial</DialogTitle>
        <DialogDescription asChild>
          <div className="flex flex-col gap-2">
            <p>Se borran para siempre:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>El contacto y su teléfono.</li>
              <li>Todas sus conversaciones, abiertas o cerradas, con sus mensajes y archivos.</li>
            </ul>
            <p>
              No se puede deshacer. Si vuelve a escribir, empezará una conversación nueva sin
              historial.
            </p>
          </div>
        </DialogDescription>
        <label className="flex flex-col gap-1 text-sm">
          <span>
            Escribe <strong className="font-mono tabular-nums">{phone}</strong> para confirmar
          </span>
          <Input
            value={typed}
            inputMode="tel"
            autoComplete="off"
            onChange={(event) => setTyped(event.target.value)}
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
            onClick={onConfirm}
          >
            {pending ? 'Borrando…' : 'Borrar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
