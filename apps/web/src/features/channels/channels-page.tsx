import type { Channel } from '@omnidesk/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldOff, Smartphone } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { activeMembership, isManagerRole, useMe } from '@/features/auth/api/use-me';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';
import { EmptyState } from '@/shared/ui/empty-state';
import { Skeleton } from '@/shared/ui/skeleton';
import { ChannelPanel } from './channel-panel';
import { ChannelRow } from './channel-row';
import { Field } from './channel-fields';
import { createChannel, fetchChannels } from './channels-api';

/** Alta de un canal de WhatsApp Cloud: nombre, número y phone_number_id. */
function CreateChannelForm({ onCreated }: { onCreated: (channel: Channel) => Promise<void> }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [externalId, setExternalId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const channel = await createChannel({
        name,
        phoneNumber: phone,
        externalId,
        provider: 'WHATSAPP_CLOUD',
      });
      await onCreated(channel);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <Field
        label="Nombre del canal"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
        maxLength={80}
      />
      <Field
        label="Número de WhatsApp (E.164)"
        placeholder="+573001234567"
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
        required
        pattern="\+[1-9][0-9]{1,14}"
      />
      <Field
        label="Phone number ID de Meta"
        value={externalId}
        onChange={(event) => setExternalId(event.target.value)}
        required
        maxLength={64}
      />
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button disabled={pending}>{pending ? 'Guardando…' : 'Crear canal'}</Button>
    </form>
  );
}

export function ChannelsPage() {
  const { data: me, isPending } = useMe();
  const membership = activeMembership(me);
  if (isPending) return <ChannelsSkeleton />;
  if (!membership || !isManagerRole(membership.role)) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={ShieldOff}
          title="No tienes acceso"
          description="Solo los Owner y Admin gestionan los canales de la empresa."
        />
      </div>
    );
  }
  return <ManagedChannels key={membership.tenantId} tenantId={membership.tenantId} />;
}

function ChannelsSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-6 md:px-8 md:py-10">
      <Skeleton className="h-8 w-40" />
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-16 w-full" />
      ))}
    </div>
  );
}

/**
 * `/settings/channels` (SPEC 17): lista con el estado de cada canal y un panel lateral por canal
 * (`?channel=<id>`) con pasos numerados. Tras crear un canal se abre su panel.
 */
function ManagedChannels({ tenantId }: { tenantId: string }) {
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get('channel');
  const channels = useQuery({ queryKey: ['channels', tenantId], queryFn: fetchChannels });
  const items = channels.data?.items;
  const open = items?.find((channel) => channel.id === openId) ?? null;

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['channels', tenantId] });
    await client.invalidateQueries({ queryKey: ['conversations'] });
  };
  const openChannel = (id: string | null) =>
    setSearchParams(id ? { channel: id } : {}, { replace: true });

  // Un `?channel=` de un canal que no existe (o de otra empresa) no abre nada y se quita de la URL.
  useEffect(() => {
    if (openId && items && !items.some((channel) => channel.id === openId)) {
      setSearchParams({}, { replace: true });
    }
  }, [openId, items, setSearchParams]);

  const addButton = (
    <Button onClick={() => setCreating(true)}>
      <Plus aria-hidden />
      Añadir WhatsApp
    </Button>
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 md:px-8 md:py-10">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Canales</h1>
            <p className="text-muted-foreground text-sm">
              Conecta WhatsApp y elige si la IA atiende tus mensajes.
            </p>
          </div>
          {addButton}
        </header>

        {channels.isPending ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : channels.isError ? (
          <Card className="py-0">
            <EmptyState
              title="No se pudieron cargar los canales"
              action={
                <Button variant="outline" onClick={() => void channels.refetch()}>
                  Reintentar
                </Button>
              }
            />
          </Card>
        ) : !items?.length ? (
          <Card className="py-0">
            <EmptyState
              icon={Smartphone}
              title="Aún no hay canales"
              description="Añade tu número de WhatsApp para empezar a recibir conversaciones."
              action={addButton}
            />
          </Card>
        ) : (
          <Card className="gap-0 overflow-hidden py-0">
            <ul className="divide-y">
              {items.map((channel) => (
                <ChannelRow
                  key={channel.id}
                  channel={channel}
                  onOpen={() => openChannel(channel.id)}
                />
              ))}
            </ul>
          </Card>
        )}

        <ChannelPanel channel={open} onClose={() => openChannel(null)} refresh={refresh} />

        <Dialog open={creating} onOpenChange={setCreating}>
          <DialogContent>
            <DialogTitle>Añadir WhatsApp</DialogTitle>
            <DialogDescription>Puedes conectar WhatsApp sin activar la IA.</DialogDescription>
            <CreateChannelForm
              onCreated={async (channel) => {
                setCreating(false);
                await refresh();
                openChannel(channel.id);
              }}
            />
          </DialogContent>
        </Dialog>
      </section>
    </div>
  );
}
