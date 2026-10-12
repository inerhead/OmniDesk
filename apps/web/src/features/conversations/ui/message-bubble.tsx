import type { Message } from '@omnidesk/contracts';
import { Clock } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { formatMessageTime } from '../model/format-time';
import { toBubbleView } from '../model/to-bubble-view';

const toneClass = {
  customer: 'bg-muted text-foreground rounded-bl-sm',
  ai: 'bg-primary text-primary-foreground rounded-br-sm',
  agent: 'bg-success text-success-foreground rounded-br-sm',
} as const;

export function MessageBubble({ message }: { message: Message }) {
  const view = toBubbleView(message);
  return (
    <li className={cn('flex', view.align === 'end' ? 'justify-end' : 'justify-start')}>
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
          {view.pending && <Clock className="size-3" aria-label="Pendiente de envío" />}
        </span>
      </div>
    </li>
  );
}
