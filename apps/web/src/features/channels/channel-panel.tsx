import type { Channel } from '@omnidesk/contracts';
import { Pencil } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/shared/ui/sheet';
import { updateChannel } from './channels-api';
import { channelSteps, PROVIDER_LABEL } from './model/channel-status';
import { AiStep } from './steps/ai-step';
import { MetaStep } from './steps/meta-step';
import { useStepAction } from './steps/use-step-action';

/** Nombre del canal, editable en línea en la cabecera del panel. */
function ChannelName({ channel, refresh }: { channel: Channel; refresh: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(channel.name);
  const { pending, notice, run } = useStepAction(refresh);

  function save(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await updateChannel(channel.id, { name: name.trim() });
      setEditing(false);
    });
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-1 pr-8">
        <SheetTitle className="truncate text-lg">{channel.name}</SheetTitle>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Renombrar canal"
          onClick={() => {
            setName(channel.name);
            setEditing(true);
          }}
        >
          <Pencil aria-hidden />
        </Button>
      </div>
    );
  }
  return (
    <form className="flex flex-col gap-2 pr-8" onSubmit={save}>
      <SheetTitle className="sr-only">{channel.name}</SheetTitle>
      <label className="sr-only" htmlFor="channel-name">
        Nombre del canal
      </label>
      <Input
        id="channel-name"
        value={name}
        maxLength={80}
        autoFocus
        onChange={(event) => setName(event.target.value)}
      />
      <div className="flex gap-2">
        <Button size="sm" disabled={pending || !name.trim() || name.trim() === channel.name}>
          Guardar
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => setEditing(false)}
        >
          Cancelar
        </Button>
      </div>
      {notice && (
        <p role="alert" className="text-destructive text-sm">
          {notice}
        </p>
      )}
    </form>
  );
}

/**
 * Panel lateral de un canal (SPEC 17): cabecera con el nombre editable y pasos numerados (Conectar
 * Meta, IA con n8n). Un canal n8n no tiene el paso de Meta.
 */
export function ChannelPanel({
  channel,
  onClose,
  refresh,
}: {
  channel: Channel | null;
  onClose: () => void;
  refresh: () => Promise<void>;
}) {
  return (
    <Sheet
      open={channel !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-[min(32rem,100vw)] overflow-y-auto">
        {channel && (
          <div key={channel.id} className="flex flex-col gap-6 p-5">
            <header className="flex flex-col gap-1">
              <ChannelName channel={channel} refresh={refresh} />
              <SheetDescription className="tabular-nums">
                {channel.phoneNumber ?? 'Sin número'} · {PROVIDER_LABEL[channel.provider]}
              </SheetDescription>
            </header>
            {channelSteps(channel).map((step) => {
              const props = { channel, step, refresh };
              if (step.key === 'meta') return <MetaStep key={step.key} {...props} />;
              return <AiStep key={step.key} {...props} />;
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
