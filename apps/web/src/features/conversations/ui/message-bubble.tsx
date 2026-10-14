import type { Message } from '@omnidesk/contracts';
import { AlertCircle, Bot, Check, CheckCheck, Clock } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { Avatar } from '@/shared/ui/avatar';
import { formatMessageTime } from '../model/format-time';
import { toBubbleView, type BubbleView, type DeliveryIcon } from '../model/to-bubble-view';
import { MessageAttachment } from './message-attachment';

const toneClass = {
  customer: 'bg-bubble-customer text-bubble-customer-foreground',
  ai: 'bg-bubble-ai text-bubble-ai-foreground',
  agent: 'bg-bubble-agent text-bubble-agent-foreground',
} as const;

/** Cola visual: la esquina del lado del emisor se afila en el último mensaje del grupo. */
const tailClass = { start: 'rounded-bl-md', end: 'rounded-br-md' } as const;

/** El azul de "Leído" se ajusta a cada fondo para mantener el contraste. */
const readClass = {
  customer: 'text-info',
  ai: 'text-info',
  agent: 'text-sky-200',
} as const;

function DeliveryTick({ icon, tone }: { icon: DeliveryIcon; tone: BubbleView['tone'] }) {
  switch (icon) {
    case 'pending':
      return <Clock className="size-3" aria-label="Pendiente de envío" />;
    case 'sent':
      return <Check className="size-3.5" aria-label="Enviado" />;
    case 'delivered':
      return <CheckCheck className="size-3.5" aria-label="Entregado" />;
    case 'read':
      return <CheckCheck className={cn('size-3.5', readClass[tone])} aria-label="Leído" />;
    case 'failed':
      return <AlertCircle className="text-destructive size-3.5" aria-label="No enviado" />;
  }
}

export function MessageBubble({
  message,
  contactName,
  showAuthor = true,
  isLastOfGroup = true,
  onRetry,
  retrying = false,
}: {
  message: Message;
  /** Encabezado de los mensajes del cliente. */
  contactName: string;
  /** Primer mensaje del grupo: lleva el encabezado de autor. */
  showAuthor?: boolean;
  /** Último mensaje del grupo: lleva la cola. */
  isLastOfGroup?: boolean;
  /** Solo lo recibe quien puede reenviar (el agente asignado). */
  onRetry?: (messageId: string) => void;
  retrying?: boolean;
}) {
  const view = toBubbleView(message);
  const failed = view.deliveryIcon === 'failed';
  const author = view.tone === 'customer' ? contactName : view.label;
  return (
    <li
      className={cn(
        'flex flex-col',
        view.align === 'end' ? 'items-end' : 'items-start',
        showAuthor ? 'mt-3' : 'mt-0.5',
      )}
    >
      {showAuthor && author && (
        <span className="text-muted-foreground mb-1 flex items-center gap-1 px-1 text-xs font-medium">
          {view.tone === 'ai' && <Bot className="size-3.5" aria-hidden />}
          {view.tone === 'agent' && message.sender && (
            <Avatar
              id={message.sender.id}
              name={message.sender.displayName}
              fallback="?"
              imageUrl={message.sender.avatarUrl}
              size="xs"
            />
          )}
          {author}
        </span>
      )}
      <div
        className={cn(
          'flex max-w-[85%] flex-col gap-0.5 rounded-2xl px-3 py-2 md:max-w-[70%]',
          toneClass[view.tone],
          isLastOfGroup && tailClass[view.align],
        )}
      >
        {message.attachment && <MessageAttachment attachment={message.attachment} />}
        {message.text && <p className="text-sm break-words whitespace-pre-wrap">{message.text}</p>}
        <span className="flex items-center justify-end gap-1 text-[11px] opacity-75">
          <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
          {view.deliveryIcon && !failed && (
            <DeliveryTick icon={view.deliveryIcon} tone={view.tone} />
          )}
        </span>
      </div>
      {failed && (
        <p className="text-destructive mt-1 flex items-center gap-1 text-xs" role="alert">
          <AlertCircle className="size-3.5" aria-hidden />
          {view.canRetry && onRetry ? (
            <button
              type="button"
              className="underline underline-offset-2 disabled:opacity-50"
              disabled={retrying}
              onClick={() => onRetry(message.id)}
            >
              No enviado · Reintentar
            </button>
          ) : (
            <span>No enviado</span>
          )}
        </p>
      )}
    </li>
  );
}
