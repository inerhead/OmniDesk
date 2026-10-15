import type { Channel } from '@omnidesk/contracts';
import { useState, type FormEvent } from 'react';
import { Button } from '@/shared/ui/button';
import { configureWhatsApp, updateChannel } from '../channels-api';
import { Field } from '../channel-fields';
import type { ChannelStep } from '../model/channel-status';
import { StepNotice, StepSection } from './step-section';
import { useStepAction } from './use-step-action';

/**
 * Paso "IA con n8n": el webhook de n8n (antes en el diálogo "Editar canal") y, en WhatsApp Cloud, el
 * interruptor de la IA, que exige webhook y credenciales como hasta ahora.
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
  const direct = channel.provider === 'WHATSAPP_CLOUD';
  const webhookChanged = webhook.trim() !== (channel.webhookUrl ?? '');

  function saveWebhook(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await updateChannel(channel.id, { webhookUrl: webhook.trim() || null });
      return 'Webhook de n8n guardado.';
    });
  }

  return (
    <StepSection step={step}>
      {direct && (
        <p className="text-muted-foreground text-sm">
          Sin IA, los mensajes llegan a la bandeja Sin asignar. Para activarla, guarda el webhook de
          n8n y genera las credenciales en el paso siguiente.
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
      {direct && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={channel.aiEnabled}
            disabled={
              pending || (!channel.aiEnabled && (!channel.webhookUrl || !channel.hasCredentials))
            }
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
    </StepSection>
  );
}
