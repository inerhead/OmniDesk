import type { Member } from '@omnidesk/contracts';
import { Check, Copy } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Avatar } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import { Skeleton } from '@/shared/ui/skeleton';
import { Tooltip } from '@/shared/ui/tooltip';
import type { useConversationCommand } from '../api/use-conversation-command';
import { useConversation } from '../api/use-conversations';
import { statusLabel } from '../model/describe-event';
import { contactLabel } from '../model/to-bubble-view';
import { ConversationActions } from './conversation-actions';
import { StatusChip } from './status-chip';

const CHANNEL_LABEL = { WHATSAPP: 'WhatsApp' } as const;
const COPIED_MS = 1500;

const startedFormat = new Intl.DateTimeFormat('es', { dateStyle: 'long', timeStyle: 'short' });

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function CopyPhone({ phone }: { phone: string }) {
  const [copied, setCopied] = useState(false);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
    } catch {
      // Sin permiso de portapapeles (contexto no seguro): el número sigue visible para copiarlo a mano.
    }
  };

  return (
    <Tooltip
      content={copied ? 'Copiado' : 'Copiar teléfono'}
      open={copied || hover}
      onOpenChange={setHover}
    >
      <Button size="sm" variant="outline" onClick={() => void copy()} aria-live="polite">
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? 'Copiado' : 'Copiar'}
      </Button>
    </Tooltip>
  );
}

/** Panel de contacto de solo lectura: datos del contacto, estado y las mismas acciones de la cabecera. */
export function ContactPanel({
  conversationId,
  actor,
  members,
  command,
}: {
  conversationId: string;
  actor: Member | null;
  members: Member[];
  command: ReturnType<typeof useConversationCommand>;
}) {
  const { data: summary } = useConversation(conversationId);

  if (!summary) {
    return (
      <div className="flex flex-col items-center gap-3 p-6" aria-busy="true">
        <Skeleton className="size-16 rounded-full" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-40" />
      </div>
    );
  }

  const name = contactLabel(summary.contact);
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <Avatar
          id={summary.contact.id}
          name={summary.contact.displayName}
          fallback={summary.contact.externalId}
          size="lg"
        />
        <p className="font-semibold break-words">{name}</p>
        <StatusChip conversation={summary} />
      </div>

      <dl className="flex flex-col gap-4">
        <Field label="Teléfono">
          <span className="flex items-center justify-between gap-2">
            <span className="font-mono text-sm tabular-nums">{summary.contact.externalId}</span>
            <CopyPhone phone={summary.contact.externalId} />
          </span>
        </Field>
        <Field label="Canal">
          {CHANNEL_LABEL[summary.channel.type]} · {summary.channel.name}
        </Field>
        <Field label="Estado">{statusLabel(summary)}</Field>
        <Field label="Inicio de la conversación">
          <time dateTime={summary.createdAt}>
            {startedFormat.format(new Date(summary.createdAt))}
          </time>
        </Field>
      </dl>

      {actor && (
        <ConversationActions
          conversation={summary}
          actor={actor}
          members={members}
          pending={command.pending}
          onRun={command.run}
          layout="stacked"
        />
      )}
    </div>
  );
}
