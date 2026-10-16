import type { Channel } from '@omnidesk/contracts';
import { useState, type FormEvent } from 'react';
import { Button } from '@/shared/ui/button';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import {
  configureN8nClient,
  configureWhatsApp,
  removeN8nClient,
  testChannel,
  updateChannel,
} from '../channels-api';
import { Field } from '../channel-fields';
import { n8nReady, type ChannelStep } from '../model/channel-status';
import { StepNotice, StepSection } from './step-section';
import { useStepAction } from './use-step-action';

/**
 * Paso "IA con n8n": el webhook de n8n, las credenciales de cliente con las que OmniDesk se
 * autentica en cada llamada (SPEC 22), la prueba de conexión y, en WhatsApp Cloud, el interruptor
 * de la IA, que exige webhook y credenciales.
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
  const [clientId, setClientId] = useState(channel.n8nClientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const direct = channel.provider === 'WHATSAPP_CLOUD';
  const webhookChanged = webhook.trim() !== (channel.webhookUrl ?? '');
  const hasClient = channel.n8nClientId !== null || channel.hasN8nClientSecret;
  const clientChanged =
    clientId.trim() !== (channel.n8nClientId ?? '') || clientSecret.trim() !== '';
  const ready = n8nReady(channel);

  function saveWebhook(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await updateChannel(channel.id, { webhookUrl: webhook.trim() || null });
      return 'Webhook de n8n guardado.';
    });
  }

  function saveClient(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const updated = await configureN8nClient(channel.id, {
        clientId: clientId.trim(),
        ...(clientSecret.trim() && { clientSecret: clientSecret.trim() }),
      });
      setClientId(updated.n8nClientId ?? '');
      setClientSecret('');
      return 'Credenciales de n8n guardadas.';
    });
  }

  function removeClient() {
    setConfirmRemove(false);
    void run(async () => {
      await removeN8nClient(channel.id);
      setClientId('');
      setClientSecret('');
      return 'Credenciales de n8n quitadas.';
    });
  }

  return (
    <StepSection step={step}>
      {direct && (
        <p className="text-muted-foreground text-sm">
          Sin IA, los mensajes llegan a la bandeja Sin asignar. Para activarla, guarda el webhook de
          n8n y sus credenciales de cliente.
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
      <form className="flex flex-col gap-3" onSubmit={saveClient}>
        <Field
          label="Client ID"
          autoComplete="off"
          maxLength={200}
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          required
        />
        <Field
          label="Client secret"
          type="password"
          autoComplete="new-password"
          minLength={16}
          maxLength={512}
          placeholder={
            channel.hasN8nClientSecret ? 'Configurado · escribe para reemplazarlo' : undefined
          }
          value={clientSecret}
          onChange={(event) => setClientSecret(event.target.value)}
          required={!channel.hasN8nClientSecret}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={pending || !clientId.trim() || !clientChanged}>
            Guardar credenciales
          </Button>
          {hasClient && (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmRemove(true)}
            >
              Quitar credenciales
            </Button>
          )}
        </div>
      </form>
      <Button
        variant="outline"
        className="self-start"
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
        open={confirmRemove}
        title="Quitar credenciales"
        description="La IA se apagará en este canal."
        confirmLabel="Quitar credenciales"
        tone="destructive"
        pending={pending}
        onConfirm={removeClient}
        onOpenChange={setConfirmRemove}
      />
    </StepSection>
  );
}
