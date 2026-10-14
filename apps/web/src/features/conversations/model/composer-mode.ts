import {
  availableCommands,
  isReplyWindowOpen,
  type ConversationSummary,
  type Member,
} from '@omnidesk/contracts';

export const WINDOW_CLOSED_NOTICE =
  'Han pasado más de 18 h desde el último mensaje del cliente. Podrás responder cuando vuelva a escribir.';

export type ComposerMode =
  /** El actor es el agente asignado: puede escribir. */
  | { kind: 'compose' }
  /** Asignada al actor, pero la ventana de 18 h ya cerró. */
  | { kind: 'window-closed' }
  /** La IA atiende: el actor puede tomar la conversación para responder. */
  | { kind: 'take' }
  /** La atiende otro agente. */
  | { kind: 'assigned-other'; name: string }
  | { kind: 'none' };

/** Qué ve el actor bajo el chat: composer, botón para tomar, aviso de asignación o nada. */
export function composerMode(
  conversation: Pick<ConversationSummary, 'status' | 'assignedAgent' | 'lastInboundAt'>,
  actor: Pick<Member, 'id' | 'role'>,
  now: Date,
): ComposerMode {
  if (conversation.status !== 'OPEN') return { kind: 'none' };

  const assigned = conversation.assignedAgent;
  if (assigned?.id === actor.id) {
    return isReplyWindowOpen(conversation.lastInboundAt, now)
      ? { kind: 'compose' }
      : { kind: 'window-closed' };
  }
  if (assigned) return { kind: 'assigned-other', name: assigned.displayName };

  const { take } = availableCommands(
    { memberId: actor.id, role: actor.role },
    { status: conversation.status, assignedAgentId: null },
  );
  return take ? { kind: 'take' } : { kind: 'none' };
}
