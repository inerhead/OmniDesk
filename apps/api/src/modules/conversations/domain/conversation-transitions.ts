import { commandApplies } from './conversation-policy';
import type { ConversationEventType } from './conversation-event';
import type { Conversation } from './conversation';

export type ConversationCommand =
  | { type: 'assign'; memberId: string }
  | { type: 'release' }
  | { type: 'close' }
  | { type: 'reopen' };

export interface ConversationState {
  status: Conversation['status'];
  assignedAgentId: string | null;
}

export type TransitionResult =
  | {
      ok: true;
      /** Estado resultante; cada transición incrementa `controlVersion`. */
      next: ConversationState;
      event: { type: ConversationEventType; targetMemberId: string | null };
    }
  | { ok: false; reason: 'INVALID_STATE' };

/**
 * Tabla de estados de docs/specs/04:
 * assign (OPEN) → agente asignado · release (OPEN y asignada) → vuelve a la IA ·
 * close (OPEN) → CLOSED conservando el agente · reopen (CLOSED) → OPEN sin agente.
 */
export function decideTransition(
  conversation: Pick<Conversation, 'status' | 'assignedAgentId'>,
  command: ConversationCommand,
): TransitionResult {
  const targetMemberId = command.type === 'assign' ? command.memberId : undefined;
  if (!commandApplies(command.type, conversation, targetMemberId)) {
    return { ok: false, reason: 'INVALID_STATE' };
  }

  switch (command.type) {
    case 'assign':
      return {
        ok: true,
        next: { status: 'OPEN', assignedAgentId: command.memberId },
        event: { type: 'ASSIGNED', targetMemberId: command.memberId },
      };
    case 'release':
      return {
        ok: true,
        next: { status: 'OPEN', assignedAgentId: null },
        event: { type: 'RELEASED', targetMemberId: null },
      };
    case 'close':
      return {
        ok: true,
        next: { status: 'CLOSED', assignedAgentId: conversation.assignedAgentId },
        event: { type: 'CLOSED', targetMemberId: null },
      };
    case 'reopen':
      return {
        ok: true,
        next: { status: 'OPEN', assignedAgentId: null },
        event: { type: 'REOPENED', targetMemberId: null },
      };
  }
}
