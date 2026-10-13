import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';

/** Confirmación dentro de la app, en lugar del diálogo nativo del navegador. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pending = false,
  tone = 'default',
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  tone?: 'default' | 'destructive';
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="pr-6">{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
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
            disabled={pending}
            className={
              tone === 'destructive'
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : undefined
            }
            onClick={onConfirm}
          >
            {pending ? 'Procesando…' : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
