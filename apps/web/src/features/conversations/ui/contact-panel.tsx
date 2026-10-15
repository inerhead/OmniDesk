import type { Member } from '@omnidesk/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ApiHttpError } from '@/shared/api/http-client';
import { Avatar } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import { Skeleton } from '@/shared/ui/skeleton';
import { Tooltip } from '@/shared/ui/tooltip';
import { deleteContact } from '../api/conversations-api';
import type { useConversationCommand } from '../api/use-conversation-command';
import { useConversation } from '../api/use-conversations';
import { markConversationDeleted } from '../model/deleted-conversations';
import { statusLabel } from '../model/describe-event';
import { contactLabel } from '../model/to-bubble-view';
import { ConversationActions } from './conversation-actions';
import { DeleteContactDialog } from './delete-contact-dialog';
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

/**
 * Borrar el contacto y su historial (SPEC 12, solo OWNER). Al terminar vuelve a la bandeja de la que
 * se abrió la conversación; las demás pestañas la quitan con el evento `deleted`.
 */
function DeleteContact({
  conversationId,
  contactId,
  contactName,
  phone,
}: {
  conversationId: string;
  contactId: string;
  contactName: string;
  phone: string;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { search } = useLocation();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: () => deleteContact(contactId),
    onSuccess: async () => {
      setOpen(false);
      markConversationDeleted(conversationId);
      await navigate({ pathname: '/conversations', search }, { replace: true });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (failure) =>
      setError(
        failure instanceof ApiHttpError && failure.status === 403
          ? 'Solo un Owner puede borrar contactos.'
          : 'No se pudo borrar el contacto. Inténtalo de nuevo.',
      ),
  });

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="border-destructive/50 text-destructive hover:text-destructive"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Trash2 aria-hidden />
        Borrar contacto y su historial
      </Button>
      <DeleteContactDialog
        open={open}
        contactName={contactName}
        phone={phone}
        pending={remove.isPending}
        error={error}
        onConfirm={() => remove.mutate()}
        onOpenChange={setOpen}
      />
    </>
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

      {actor?.role === 'OWNER' && (
        <DeleteContact
          conversationId={conversationId}
          contactId={summary.contact.id}
          contactName={name}
          phone={summary.contact.externalId}
        />
      )}
    </div>
  );
}
