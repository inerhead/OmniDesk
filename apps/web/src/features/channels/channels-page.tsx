import type { Channel, ChannelCredentialsResponse } from '@omnidesk/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useState, type FormEvent, type ComponentProps, type KeyboardEvent } from 'react';
import { cn } from '@/shared/lib/utils';
import { activeMembership, isManagerRole, useMe } from '@/features/auth/api/use-me';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';
import {
  configureWhatsApp,
  createChannel,
  fetchChannels,
  issueCredentials,
  testChannel,
  updateChannel,
} from './channels-api';

function Field({ label, ...props }: ComponentProps<typeof Input> & { label: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      <Input {...props} />
    </label>
  );
}
function CopyValue({ label, value }: { label: string; value: string }) {
  const [notice, setNotice] = useState('');
  return (
    <div className="flex flex-col gap-2">
      <Field label={label} value={value} readOnly />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard
              .writeText(value)
              .then(() => setNotice('Copiado'))
              .catch(() => setNotice('No se pudo copiar; selecciona el texto.'));
          }}
        >
          Copiar {label}
        </Button>
        <span role="status" className="text-xs">
          {notice}
        </span>
      </div>
    </div>
  );
}
function ChannelForm({ channel, onSaved }: { channel?: Channel; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(channel?.name ?? '');
  const [phone, setPhone] = useState(channel?.phoneNumber ?? '');
  const [externalId, setExternalId] = useState(channel?.externalId ?? '');
  const [webhook, setWebhook] = useState(channel?.webhookUrl ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      if (channel) await updateChannel(channel.id, { name, webhookUrl: webhook || null });
      else
        await createChannel({
          name,
          phoneNumber: phone,
          externalId,
          provider: 'WHATSAPP_CLOUD',
          ...(webhook && { webhookUrl: webhook }),
        });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
      <Field
        label="Nombre del canal"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={80}
      />
      {!channel && (
        <>
          <Field
            label="Número de WhatsApp (E.164)"
            placeholder="+573001234567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            pattern="\+[1-9][0-9]{1,14}"
          />
          <Field
            label="Phone number ID de Meta"
            value={externalId}
            onChange={(e) => setExternalId(e.target.value)}
            required
            maxLength={64}
          />
        </>
      )}
      <Field
        label={
          channel?.provider === 'N8N' ? 'Webhook n8n de envío' : 'Webhook n8n de IA (opcional)'
        }
        type="url"
        placeholder="https://n8n.example.com/webhook/…"
        value={webhook}
        onChange={(e) => setWebhook(e.target.value)}
        required={channel?.provider === 'N8N'}
      />
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button disabled={pending}>
        {pending ? 'Guardando…' : channel ? 'Guardar cambios' : 'Crear canal'}
      </Button>
    </form>
  );
}
function ChannelCard({ channel, refresh }: { channel: Channel; refresh: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [credentials, setCredentials] = useState<ChannelCredentialsResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [open, setOpen] = useState(false);
  const direct = channel.provider === 'WHATSAPP_CLOUD';
  function toggle() {
    setOpen((value) => !value);
  }
  function toggleOnKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggle();
  }
  async function run(work: () => Promise<void>) {
    setPending(true);
    setNotice('');
    try {
      await work();
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'No se pudo completar la acción');
    } finally {
      setPending(false);
    }
  }
  async function issue() {
    setConfirmRotate(false);
    await run(async () => {
      setCredentials(await issueCredentials(channel.id));
    });
  }
  function generate() {
    if (channel.hasCredentials) {
      setConfirmRotate(true);
      return;
    }
    void issue();
  }
  return (
    <Card>
      <CardHeader
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={toggleOnKey}
        className="cursor-pointer"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex min-w-0 items-center gap-2">
            <ChevronDown
              className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')}
              aria-hidden
            />
            <span className="truncate">{channel.name}</span>
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              setEditing(true);
            }}
            onKeyDown={(event) => event.stopPropagation()}
          >
            Editar
          </Button>
        </div>
        <p className="text-muted-foreground text-sm">
          {channel.phoneNumber ?? 'Sin número'} · {direct ? 'WhatsApp Cloud' : channel.provider}
        </p>
      </CardHeader>
      <CardContent hidden={!open} className="flex flex-col gap-5">
        {direct && (
          <>
            <div className="rounded-lg border p-4">
              <h3 className="mb-3 font-medium">1. Conectar WhatsApp</h3>
              <p className="text-muted-foreground mb-3 text-sm">
                En Meta, configura esta URL como callback y suscríbete a los eventos de mensajes.
                Usa el mismo verify token que guardes aquí.
              </p>
              {channel.whatsappWebhookUrl && (
                <CopyValue label="Webhook de WhatsApp" value={channel.whatsappWebhookUrl} />
              )}
            </div>
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await configureWhatsApp(channel.id, {
                    ...(accessToken && { accessToken }),
                    ...(appSecret && { appSecret }),
                    ...(verifyToken && { verifyToken }),
                  });
                  setAccessToken('');
                  setAppSecret('');
                  setVerifyToken('');
                  setNotice('Credenciales de Meta guardadas.');
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
                onChange={(e) => setAccessToken(e.target.value)}
                required={!channel.hasWhatsAppCredentials}
              />
              <Field
                label="App secret de Meta"
                type="password"
                autoComplete="new-password"
                minLength={16}
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                required={!channel.hasWhatsAppCredentials}
              />
              <Field
                label="Verify token (mínimo 24 caracteres)"
                type="password"
                autoComplete="new-password"
                minLength={24}
                value={verifyToken}
                onChange={(e) => setVerifyToken(e.target.value)}
                required={!channel.hasWhatsAppCredentials}
              />
              <p className="text-muted-foreground text-xs">
                Los secretos no se volverán a mostrar. Conserva tu verify token para configurarlo en
                Meta.
              </p>
              <Button
                variant="outline"
                disabled={pending || !(accessToken || appSecret || verifyToken)}
              >
                Guardar credenciales de Meta
              </Button>
            </form>
            <div className="rounded-lg border p-4">
              <h3 className="mb-2 font-medium">2. Inteligencia artificial (opcional)</h3>
              <p className="text-muted-foreground mb-3 text-sm">
                Sin IA, los mensajes llegan a la bandeja Sin asignar. Para activarla, guarda el
                webhook de n8n en Editar y genera el secreto de integración.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={channel.aiEnabled}
                  disabled={
                    pending ||
                    (!channel.aiEnabled && (!channel.webhookUrl || !channel.hasCredentials))
                  }
                  onChange={(e) => {
                    const aiEnabled = e.target.checked;
                    void run(async () => {
                      await configureWhatsApp(channel.id, { aiEnabled });
                      setNotice(aiEnabled ? 'IA activada.' : 'IA desactivada.');
                    });
                  }}
                />
                Activar respuestas de IA
              </label>
            </div>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={pending} onClick={generate}>
            {channel.hasCredentials ? 'Rotar credenciales' : 'Generar credenciales'}
          </Button>
          <Button
            variant="outline"
            disabled={pending || !channel.webhookUrl || !channel.hasCredentials}
            onClick={() =>
              void run(async () => {
                const result = await testChannel(channel.id);
                setNotice(
                  result.ok
                    ? `Conexión correcta · ${result.latencyMs} ms`
                    : `Error de conexión: ${result.error ?? result.httpStatus ?? 'sin respuesta'}`,
                );
              })
            }
          >
            {pending ? 'Procesando…' : 'Probar conexión n8n'}
          </Button>
        </div>
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
        <Dialog open={editing} onOpenChange={setEditing}>
          <DialogContent>
            <DialogTitle>Editar canal</DialogTitle>
            <DialogDescription>Actualiza el nombre y el webhook de n8n.</DialogDescription>
            <ChannelForm
              channel={channel}
              onSaved={async () => {
                setEditing(false);
                await refresh();
              }}
            />
          </DialogContent>
        </Dialog>
        <ConfirmDialog
          open={confirmRotate}
          title="Rotar credenciales"
          description="Las anteriores seguirán válidas 24 horas. Los valores nuevos se muestran una sola vez: cópialos y actualízalos en n8n."
          confirmLabel="Rotar credenciales"
          pending={pending}
          onConfirm={() => void issue()}
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
      </CardContent>
    </Card>
  );
}
export function ChannelsPage() {
  const { data: me, isPending } = useMe();
  const membership = activeMembership(me);
  if (isPending) return <p className="p-6">Cargando…</p>;
  if (!membership || !isManagerRole(membership.role))
    return <p className="p-6">Solo OWNER y ADMIN pueden gestionar canales.</p>;
  return <ManagedChannels key={membership.tenantId} tenantId={membership.tenantId} />;
}
function ManagedChannels({ tenantId }: { tenantId: string }) {
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const channels = useQuery({ queryKey: ['channels', tenantId], queryFn: fetchChannels });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['channels', tenantId] });
    await client.invalidateQueries({ queryKey: ['conversations'] });
  };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <section className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 md:px-8 md:py-10">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Canales</h1>
            <p className="text-muted-foreground text-sm">
              Conecta WhatsApp y elige si la IA atiende tus mensajes.
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>Añadir WhatsApp</Button>
        </header>
        {channels.isPending && <p>Cargando canales…</p>}
        {channels.isError && (
          <div role="alert">
            No se pudieron cargar los canales.{' '}
            <Button variant="outline" onClick={() => void channels.refetch()}>
              Reintentar
            </Button>
          </div>
        )}
        {channels.data?.items.length === 0 && (
          <p className="text-muted-foreground">
            Todavía no hay canales. Añade tu número de WhatsApp para empezar.
          </p>
        )}
        {channels.data?.items.map((channel) => (
          <ChannelCard key={channel.id} channel={channel} refresh={refresh} />
        ))}
        <Dialog open={creating} onOpenChange={setCreating}>
          <DialogContent>
            <DialogTitle>Añadir WhatsApp</DialogTitle>
            <DialogDescription>Puedes conectar WhatsApp sin activar la IA.</DialogDescription>
            <ChannelForm
              onSaved={async () => {
                setCreating(false);
                await refresh();
              }}
            />
          </DialogContent>
        </Dialog>
      </section>
    </div>
  );
}
