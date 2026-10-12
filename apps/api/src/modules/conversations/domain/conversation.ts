export type ConversationStatus = 'OPEN' | 'CLOSED';

export interface Conversation {
  id: string;
  tenantId: string;
  channelId: string;
  contactId: string;
  status: ConversationStatus;
  assignedAgentId: string | null;
  controlVersion: number;
  lastSequence: number;
  lastMessageAt: Date;
  lastMessagePreview: string;
}

export const PREVIEW_LENGTH = 120;

/** Vista previa de una línea: espacios colapsados y recorte a 120 caracteres con "…". */
export function toPreview(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length <= PREVIEW_LENGTH
    ? singleLine
    : `${singleLine.slice(0, PREVIEW_LENGTH - 1)}…`;
}

/** La IA atiende solo conversaciones abiertas y sin agente asignado. */
export function isAiActive(
  conversation: Pick<Conversation, 'status' | 'assignedAgentId'>,
): boolean {
  return conversation.status === 'OPEN' && conversation.assignedAgentId === null;
}

export type AiReplyDecision =
  { allowed: true } | { allowed: false; reason: 'CONTROL_CHANGED' | 'CONVERSATION_CLOSED' };

/**
 * Protocolo de control de IA (docs/arquitectura.md §9): la respuesta solo se registra si la
 * conversación sigue abierta, sin agente y con el mismo `controlVersion` que recibió la IA.
 */
export function decideAiReply(
  conversation: Pick<Conversation, 'status' | 'assignedAgentId' | 'controlVersion'>,
  controlVersion: number,
): AiReplyDecision {
  if (conversation.status !== 'OPEN') return { allowed: false, reason: 'CONVERSATION_CLOSED' };
  if (conversation.assignedAgentId !== null || conversation.controlVersion !== controlVersion) {
    return { allowed: false, reason: 'CONTROL_CHANGED' };
  }
  return { allowed: true };
}

/** Efecto de añadir un mensaje: siguiente `sequence` y resumen para la lista. */
export function appendMessage(
  conversation: Pick<Conversation, 'lastSequence'>,
  text: string,
  at: Date,
): Pick<Conversation, 'lastSequence' | 'lastMessageAt' | 'lastMessagePreview'> {
  return {
    lastSequence: conversation.lastSequence + 1,
    lastMessageAt: at,
    lastMessagePreview: toPreview(text),
  };
}
