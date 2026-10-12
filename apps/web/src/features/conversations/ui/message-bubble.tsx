import type { Message } from '@omnidesk/contracts';
import { AlertCircle, Check, CheckCheck, Clock } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { formatMessageTime } from '../model/format-time';
import { toBubbleView, type DeliveryIcon } from '../model/to-bubble-view';

const toneClass = {
  customer: 'bg-muted text-foreground rounded-bl-sm',
  ai: 'bg-primary text-primary-foreground rounded-br-sm',
  agent: 'bg-success text-success-foreground rounded-br-sm',
} as const;

function DeliveryTick({ icon }: { icon: DeliveryIcon }) {
  switch (icon) {
    case 'pending':
      return <Clock className="size-3" aria-label="Pendiente de envío" />;
    case 'sent':
      return <Check className="size-3.5" aria-label="Enviado" />;
    case 'delivered':
      return <CheckCheck className="size-3.5" aria-label="Entregado" />;
    case 'read':
      return <CheckCheck className="size-3.5 text-sky-400" aria-label="Leído" />;
    case 'failed':
      return <AlertCircle className="text-destructive size-3.5" aria-label="No enviado" />;
  }
}

export function MessageBubble({
  message,
  onRetry,
  retrying = false,
}: {
  message: Message;
  /** Solo lo recibe quien puede reenviar (el agente asignado). */
  onRetry?: (messageId: string) => void;
  retrying?: boolean;
}) {
  const view = toBubbleView(message);
  const failed = view.deliveryIcon === 'failed';
  return (
    <li className={cn('flex flex-col', view.align === 'end' ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'flex max-w-[80%] flex-col gap-1 rounded-2xl px-3 py-2 shadow-xs',
          toneClass[view.tone],
        )}
      >
        {view.label && <span className="text-xs font-semibold opacity-80">{view.label}</span>}
        <p className="text-sm break-words whitespace-pre-wrap">{message.text}</p>
        <span className="flex items-center justify-end gap-1 text-[11px] opacity-70">
          <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
          {view.deliveryIcon && !failed && <DeliveryTick icon={view.deliveryIcon} />}
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
