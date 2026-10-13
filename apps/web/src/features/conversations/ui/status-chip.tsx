import type { ConversationSummary } from '@omnidesk/contracts';
import { Bot, UserRound } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { WhatsAppMark } from './whatsapp-mark';

function WhatsAppChip() {
  return (
    <Badge variant="outline" aria-label="WhatsApp" className="text-[#25D366]">
      <WhatsAppMark />
    </Badge>
  );
}

/** IA si la atiende la IA. WhatsApp si es directa; con agente, el icono se queda junto al nombre. */
export function StatusChip({
  conversation,
  className,
}: {
  conversation: Pick<ConversationSummary, 'status' | 'assignedAgent' | 'aiActive' | 'channel'>;
  className?: string;
}) {
  const fromWhatsApp = conversation.channel.type === 'WHATSAPP';
  if (conversation.status === 'CLOSED') {
    return (
      <Badge variant="outline" className={cn('text-muted-foreground', className)}>
        Cerrada
      </Badge>
    );
  }
  if (conversation.aiActive) {
    return (
      <Badge variant="brand" className={className}>
        <Bot aria-hidden />
        IA
      </Badge>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {fromWhatsApp && <WhatsAppChip />}
      {conversation.assignedAgent && (
        <Badge variant="warning" className="max-w-32">
          <UserRound aria-hidden />
          <span className="truncate">{conversation.assignedAgent.displayName}</span>
        </Badge>
      )}
    </span>
  );
}
