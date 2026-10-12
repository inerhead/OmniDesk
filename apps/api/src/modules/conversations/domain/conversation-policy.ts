/**
 * Política de permisos y de estados de las conversaciones (docs/specs/04). Es una función pura.
 * La web usa una copia en `@omnidesk/contracts` solo para mostrar u ocultar botones; el API siempre
 * decide. `application/conversation-policy-parity.spec.ts` garantiza que ambas dan lo mismo.
 */

export type MemberRole = 'OWNER' | 'ADMIN' | 'AGENT';
export type Inbox = 'ai' | 'mine' | 'all' | 'closed';
export type PolicyAction = 'view' | 'assign' | 'release' | 'close' | 'reopen';
export type ConversationCommandName = 'assign' | 'release' | 'close' | 'reopen';

export interface PolicyActor {
  memberId: string;
  role: MemberRole;
}

export interface PolicyConversation {
  status: 'OPEN' | 'CLOSED';
  assignedAgentId: string | null;
}

/** OWNER y ADMIN supervisan todo; un AGENT solo lo suyo y lo que está sin asignar. */
export function isManager(role: MemberRole): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export function canViewInbox(actor: PolicyActor, inbox: Inbox): boolean {
  return inbox !== 'all' || isManager(actor.role);
}

/**
 * ¿Puede el actor ejecutar `action` sobre la conversación?
 * Para `assign`, `targetMemberId` es el miembro al que se asigna; sin él se entiende "a otro".
 * Solo mira permisos: si el comando aplica al estado actual lo decide `commandApplies`.
 */
export function can(
  actor: PolicyActor,
  action: PolicyAction,
  conversation: PolicyConversation,
  targetMemberId?: string,
): boolean {
  if (isManager(actor.role)) return true;

  const isMine = conversation.assignedAgentId === actor.memberId;
  const isUnassigned = conversation.assignedAgentId === null;
  switch (action) {
    case 'view':
      return isUnassigned || isMine;
    case 'assign':
      // "Tomar": solo a sí mismo y solo si está sin asignar.
      return targetMemberId === actor.memberId && isUnassigned;
    case 'release':
    case 'close':
    case 'reopen':
      return isMine;
  }
}

/** ¿Tiene sentido el comando en el estado actual? Si no, el API responde `409 INVALID_STATE`. */
export function commandApplies(
  command: ConversationCommandName,
  conversation: PolicyConversation,
  targetMemberId?: string,
): boolean {
  switch (command) {
    case 'assign':
      return conversation.status === 'OPEN' && conversation.assignedAgentId !== targetMemberId;
    case 'release':
      return conversation.status === 'OPEN' && conversation.assignedAgentId !== null;
    case 'close':
      return conversation.status === 'OPEN';
    case 'reopen':
      return conversation.status === 'CLOSED';
  }
}
