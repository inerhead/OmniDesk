import type { Channel } from '@omnidesk/contracts';
import { useState } from 'react';
import { Button } from '@/shared/ui/button';
import { configureWhatsApp } from '../channels-api';
import { CopyValue, Field } from '../channel-fields';
import type { ChannelStep } from '../model/channel-status';
import { StepNotice, StepSection } from './step-section';
import { useStepAction } from './use-step-action';

/** Paso "Conectar Meta" (solo WhatsApp Cloud): webhook de Meta y secretos de la app. */
export function MetaStep({
  channel,
  step,
  refresh,
}: {
  channel: Channel;
  step: ChannelStep;
  refresh: () => Promise<void>;
}) {
  const { pending, notice, run } = useStepAction(refresh);
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [verifyToken, setVerifyToken] = useState('');

  return (
    <StepSection step={step}>
      <p className="text-muted-foreground text-sm">
        En Meta, configura esta URL como callback y suscríbete a los eventos de mensajes. Usa el
        mismo verify token que guardes aquí.
      </p>
      {channel.whatsappWebhookUrl && (
        <CopyValue label="Webhook de WhatsApp" value={channel.whatsappWebhookUrl} />
      )}
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await configureWhatsApp(channel.id, {
              ...(accessToken && { accessToken }),
              ...(appSecret && { appSecret }),
              ...(verifyToken && { verifyToken }),
            });
            setAccessToken('');
            setAppSecret('');
            setVerifyToken('');
            return 'Credenciales de Meta guardadas.';
          });
        }}
      >
        <p className="text-sm">
          {channel.hasWhatsAppCredentials
            ? 'Meta configurado. Completa solo los secretos que quieras sustituir.'
            : 'Guarda las credenciales de tu aplicación de Meta.'}
        </p>
        <Field
          label="Access token de Meta"
          type="password"
          autoComplete="new-password"
          value={accessToken}
          onChange={(event) => setAccessToken(event.target.value)}
          required={!channel.hasWhatsAppCredentials}
        />
        <Field
          label="App secret de Meta"
          type="password"
          autoComplete="new-password"
          minLength={16}
          value={appSecret}
          onChange={(event) => setAppSecret(event.target.value)}
          required={!channel.hasWhatsAppCredentials}
        />
        <Field
          label="Verify token (mínimo 24 caracteres)"
          type="password"
          autoComplete="new-password"
          minLength={24}
          value={verifyToken}
          onChange={(event) => setVerifyToken(event.target.value)}
          required={!channel.hasWhatsAppCredentials}
        />
        <p className="text-muted-foreground text-xs">
          Los secretos no se volverán a mostrar. Conserva tu verify token para configurarlo en Meta.
        </p>
        <Button
          variant="outline"
          className="self-start"
          disabled={pending || !(accessToken || appSecret || verifyToken)}
        >
          Guardar credenciales de Meta
        </Button>
      </form>
      <StepNotice notice={notice} />
    </StepSection>
  );
}
