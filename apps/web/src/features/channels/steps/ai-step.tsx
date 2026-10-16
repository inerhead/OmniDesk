import type { Channel, N8nClientCredentialsResponse } from '@omnidesk/contracts';
import { useState, type FormEvent } from 'react';
import { Button } from '@/shared/ui/button';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';
import {
  configureWhatsApp,
  generateN8nClientSecret,
  removeN8nClient,
  testChannel,
  updateChannel,
} from '../channels-api';
import { CopyValue, Field } from '../channel-fields';
import { n8nReady, type ChannelStep } from '../model/channel-status';
import { StepNotice, StepSection } from './step-section';
import { useStepAction } from './use-step-action';

/**
 * Paso "IA con n8n": el webhook de n8n, las credenciales con las que OmniDesk se autentica en cada
 * llamada (Client ID = id del canal y un client secret que genera OmniDesk, SPEC 22), la prueba de
 * conexión y, en WhatsApp Cloud, el interruptor de la IA, que exige webhook y secreto.
 */
export function AiStep({
  channel,
  step,
  refresh,
}: {
  channel: Channel;
  step: ChannelStep;
  refresh: () => Promise<void>;
}) {
  const { pending, notice, run } = useStepAction(refresh);
  const [webhook, setWebhook] = useState(channel.webhookUrl ?? '');
  const [generated, setGenerated] = useState<N8nClientCredentialsResponse | null>(null);
  const [confirm, setConfirm] = useState<'regenerate' | 'remove' | null>(null);
  const direct = channel.provider === 'WHATSAPP_CLOUD';
  const webhookChanged = webhook.trim() !== (channel.webhookUrl ?? '');
  const ready = n8nReady(channel);

  function saveWebhook(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await updateChannel(channel.id, { webhookUrl: webhook.trim() || null });
      return 'Webhook de n8n guardado.';
    });
  }

  function generate() {
    setConfirm(null);
    void run(async () => {
      setGenerated(await generateN8nClientSecret(channel.id));
    });
  }

  function remove() {
    setConfirm(null);
    void run(async () => {
      await removeN8nClient(channel.id);
      return 'Client secret quitado.';
    });
  }

  return (
    <StepSection step={step}>
      {direct && (
        <p className="text-muted-foreground text-sm">
          Sin IA, los mensajes llegan a la bandeja Sin asignar. Para activarla, guarda el webhook de
          n8n y genera el client secret.
        </p>
      )}
      <form className="flex flex-col gap-3" onSubmit={saveWebhook}>
        <Field
          label={
            channel.provider === 'N8N' ? 'Webhook n8n de envío' : 'Webhook n8n de IA (opcional)'
          }
          type="url"
          placeholder="https://n8n.example.com/webhook/…"
          value={webhook}
          onChange={(event) => setWebhook(event.target.value)}
          required={channel.provider === 'N8N'}
        />
        <Button variant="outline" className="self-start" disabled={pending || !webhookChanged}>
          Guardar webhook
        </Button>
      </form>
      <CopyValue label="Client ID" value={channel.id} />
      <p className="text-muted-foreground text-sm">
        {channel.hasN8nClientSecret ? 'Client secret configurado.' : 'Sin client secret.'} OmniDesk
        los envía a n8n en <code>X-Client-Id</code> y <code>X-Client-Secret</code>.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => (channel.hasN8nClientSecret ? setConfirm('regenerate') : generate())}
        >
          {channel.hasN8nClientSecret ? 'Regenerar client secret' : 'Generar client secret'}
        </Button>
        {channel.hasN8nClientSecret && (
          <Button variant="outline" disabled={pending} onClick={() => setConfirm('remove')}>
            Quitar client secret
          </Button>
        )}
        <Button
          variant="outline"
          disabled={pending || !ready}
          onClick={() =>
            void run(async () => {
              const result = await testChannel(channel.id);
              return result.ok
                ? `Conexión correcta · ${result.latencyMs} ms`
                : `Error de conexión: ${result.error ?? result.httpStatus ?? 'sin respuesta'}`;
            })
          }
        >
          {pending ? 'Procesando…' : 'Probar conexión'}
        </Button>
      </div>
      {direct && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={channel.aiEnabled}
            disabled={pending || (!channel.aiEnabled && !ready)}
            onChange={(event) => {
              const aiEnabled = event.target.checked;
              void run(async () => {
                await configureWhatsApp(channel.id, { aiEnabled });
                return aiEnabled ? 'IA activada.' : 'IA desactivada.';
              });
            }}
          />
          Activar respuestas de IA
        </label>
      )}
      <StepNotice notice={notice} />

      <ConfirmDialog
        open={confirm === 'regenerate'}
        title="Regenerar client secret"
        description="El secreto actual deja de valer al instante. Tendrás que actualizarlo en n8n."
        confirmLabel="Regenerar client secret"
        pending={pending}
        onConfirm={generate}
        onOpenChange={(open) => setConfirm(open ? 'regenerate' : null)}
      />
      <ConfirmDialog
        open={confirm === 'remove'}
        title="Quitar client secret"
        description="La IA se apagará en este canal."
        confirmLabel="Quitar client secret"
        tone="destructive"
        pending={pending}
        onConfirm={remove}
        onOpenChange={(open) => setConfirm(open ? 'remove' : null)}
      />
      <Dialog
        open={generated !== null}
        onOpenChange={(open) => {
          if (!open) setGenerated(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Client secret generado</DialogTitle>
          <DialogDescription>No volverás a verlo. Cópialo antes de cerrar.</DialogDescription>
          {generated && (
            <>
              <CopyValue label="Client ID" value={generated.clientId} />
              <CopyValue label="Client secret" value={generated.clientSecret} />
            </>
          )}
          <Button onClick={() => setGenerated(null)}>Ya lo guardé</Button>
        </DialogContent>
      </Dialog>
    </StepSection>
  );
}
