import type { TenantDetails } from '@omnidesk/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { SegmentedControl } from '@/shared/ui/segmented-control';
import { fetchRetentionPreview, patchCompany, RETENTION_PREVIEW_QUERY_KEY } from './company-api';
import {
  fromRetentionChoice,
  RETENTION_CHOICES,
  retentionPreviewNotice,
  toRetentionChoice,
  type RetentionChoice,
} from './retention';

/**
 * Cuánto se conservan las conversaciones cerradas (SPEC 12). Antes de guardar se ve cuántas borraría
 * la próxima ejecución del job, y si borra alguna se pide confirmación.
 */
export function RetentionCard({
  company,
  onSaved,
}: {
  company: TenantDetails;
  onSaved: (company: TenantDetails) => Promise<void>;
}) {
  const [choice, setChoice] = useState<RetentionChoice>(toRetentionChoice(company.retentionDays));
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const days = fromRetentionChoice(choice);
  const changed = days !== company.retentionDays;

  const preview = useQuery({
    queryKey: [...RETENTION_PREVIEW_QUERY_KEY, company.id, days],
    queryFn: () => fetchRetentionPreview(days!),
    enabled: changed && days !== null,
    staleTime: 0,
  });
  const toDelete = days === null ? 0 : preview.data;

  const save = useMutation({
    mutationFn: () => patchCompany({ retentionDays: days }),
    onSuccess: async (next) => {
      setConfirming(false);
      setNotice('Retención guardada.');
      await onSaved(next);
    },
    onError: () => {
      setConfirming(false);
      setNotice('No se pudo guardar la retención. Inténtalo de nuevo.');
    },
  });

  const submit = () => {
    if (!changed || toDelete === undefined) return;
    if (toDelete > 0) setConfirming(true);
    else save.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Retención de datos</CardTitle>
        <CardDescription>
          Las conversaciones cerradas más antiguas que el plazo elegido se borran cada día a las
          03:30, con sus mensajes y archivos. Las abiertas nunca se borran.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Conservar conversaciones cerradas</span>
          <SegmentedControl
            label="Conservar conversaciones cerradas"
            options={RETENTION_CHOICES}
            value={choice}
            renderOption={(option, props) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={props.active}
                className={props.className}
                disabled={save.isPending}
                onClick={() => {
                  setNotice(null);
                  setChoice(option.value);
                }}
              >
                {option.label}
              </button>
            )}
          />
        </div>
        {changed && (
          <p role="status" className="text-muted-foreground text-sm">
            {days === null
              ? 'Ya no se borrará ninguna conversación por antigüedad.'
              : preview.isError
                ? 'No se pudo calcular cuántas se borrarían.'
                : toDelete === undefined
                  ? 'Calculando…'
                  : retentionPreviewNotice(toDelete)}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            disabled={!changed || toDelete === undefined || save.isPending}
            onClick={submit}
          >
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
          {notice && (
            <p role="status" className="text-muted-foreground text-sm">
              {notice}
            </p>
          )}
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirming}
        title="Borrar conversaciones antiguas"
        description={`${retentionPreviewNotice(toDelete ?? 0)} No se puede deshacer; el backup diario las conserva 7 días.`}
        confirmLabel="Guardar y borrar"
        tone="destructive"
        pending={save.isPending}
        onConfirm={() => save.mutate()}
        onOpenChange={setConfirming}
      />
    </Card>
  );
}
