import type { Channel, ChannelCredentialsResponse } from '@omnidesk/contracts';
import { useState } from 'react';
import { Button } from '@/shared/ui/button';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';
import { issueCredentials, testChannel } from '../channels-api';
import { CopyValue } from '../channel-fields';
import type { ChannelStep } from '../model/channel-status';
import { StepNotice, StepSection } from './step-section';
import { useStepAction } from './use-step-action';

/** Paso "Credenciales de n8n": generar o rotar la API key y el secreto HMAC, y probar la conexión. */
export function CredentialsStep({
  channel,
  step,
  refresh,
}: {
  channel: Channel;
  step: ChannelStep;
  refresh: () => Promise<void>;
}) {
  const { pending, notice, run } = useStepAction(refresh);
  const [credentials, setCredentials] = useState<ChannelCredentialsResponse | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);

  function issue() {
    setConfirmRotate(false);
    void run(async () => {
      setCredentials(await issueCredentials(channel.id));
    });
  }

  return (
    <StepSection step={step}>
      <p className="text-muted-foreground text-sm">
        n8n usa una API key y un secreto HMAC para hablar con OmniDesk. Se muestran una sola vez.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => (channel.hasCredentials ? setConfirmRotate(true) : issue())}
        >
          {channel.hasCredentials ? 'Rotar credenciales' : 'Generar credenciales'}
        </Button>
        <Button
          variant="outline"
          disabled={pending || !channel.webhookUrl || !channel.hasCredentials}
          onClick={() =>
            void run(async () => {
              const result = await testChannel(channel.id);
              return result.ok
                ? `Conexión correcta · ${result.latencyMs} ms`
                : `Error de conexión: ${result.error ?? result.httpStatus ?? 'sin respuesta'}`;
            })
          }
        >
          {pending ? 'Procesando…' : 'Probar conexión n8n'}
        </Button>
      </div>
      <StepNotice notice={notice} />

      <ConfirmDialog
        open={confirmRotate}
        title="Rotar credenciales"
        description="Las anteriores seguirán válidas 24 horas. Los valores nuevos se muestran una sola vez: cópialos y actualízalos en n8n."
        confirmLabel="Rotar credenciales"
        pending={pending}
        onConfirm={issue}
        onOpenChange={setConfirmRotate}
      />
      <Dialog
        open={credentials !== null}
        onOpenChange={(open) => {
          if (!open) setCredentials(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Credenciales generadas</DialogTitle>
          <DialogDescription>
            No volverás a verlos. Copia y guarda estos valores antes de cerrar.
          </DialogDescription>
          {credentials && (
            <>
              <CopyValue label="API key" value={credentials.apiKey} />
              <CopyValue label="Secreto HMAC" value={credentials.hmacSecret} />
              {credentials.previousValidUntil && (
                <p className="text-sm">
                  Las anteriores son válidas hasta{' '}
                  {new Date(credentials.previousValidUntil).toLocaleString()}.
                </p>
              )}
            </>
          )}
          <Button onClick={() => setCredentials(null)}>Ya los guardé</Button>
        </DialogContent>
      </Dialog>
    </StepSection>
  );
}
