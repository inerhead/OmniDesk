import type { ConversationSummary } from '@omnidesk/contracts';
import { Bot, UserRound } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';

/** Quién atiende: la IA, un agente, un mensaje directo sin IA, o "Cerrada". */
export function StatusChip({
  conversation,
  className,
}: {
  conversation: Pick<ConversationSummary, 'status' | 'assignedAgent' | 'aiActive'>;
  className?: string;
}) {
  if (conversation.status === 'CLOSED') {
    return (
      <Badge variant="outline" className={cn('text-muted-foreground', className)}>
        Cerrada
      </Badge>
    );
  }
  if (conversation.assignedAgent) {
    return (
      <Badge variant="warning" className={cn('max-w-32', className)}>
        <UserRound aria-hidden />
        <span className="truncate">{conversation.assignedAgent.displayName}</span>
      </Badge>
    );
  }
  if (!conversation.aiActive)
    return (
      <Badge variant="outline" className={className}>
        Sin IA
      </Badge>
    );
  return (
    <Badge variant="brand" className={className}>
      <Bot aria-hidden />
      IA
    </Badge>
  );
}
