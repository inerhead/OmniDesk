import { PlatformReasonSchema } from '@omnidesk/contracts';
import { useState, type FormEvent } from 'react';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';

/** Diálogo con el motivo obligatorio (5–500 caracteres) de un rechazo o una suspensión. */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  placeholder,
  pending,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  placeholder: string;
  pending: boolean;
  onConfirm: (reason: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const valid = PlatformReasonSchema.safeParse(reason).success;
  const length = reason.trim().length;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) onConfirm(reason.trim());
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason('');
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogTitle className="pr-6">{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Motivo
            <textarea
              value={reason}
              rows={4}
              maxLength={500}
              autoFocus
              placeholder={placeholder}
              aria-invalid={length > 0 && !valid}
              aria-describedby="reason-help"
              className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30 min-h-24 w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm font-normal shadow-xs outline-none focus-visible:ring-[3px]"
              onChange={(event) => setReason(event.target.value)}
            />
            <span id="reason-help" className="text-muted-foreground text-xs font-normal">
              Entre 5 y 500 caracteres · {length}/500
            </span>
          </label>
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
              type="submit"
              disabled={pending || !valid}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pending ? 'Procesando…' : confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
