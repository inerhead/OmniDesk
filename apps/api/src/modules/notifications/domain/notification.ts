export type NotificationKind =
  | 'assigned'
  | 'customer_message'
  | 'send_failed'
  | 'new_ai_conversation';

export interface PushContact {
  displayName: string | null;
  externalId: string;
}

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
  tenantId: string;
}

export interface MemberPrefs {
  id: string;
  role: 'OWNER' | 'ADMIN' | 'AGENT';
  notifyAssigned: boolean;
  notifyCustomerMessage: boolean;
  notifySendFailed: boolean;
  notifyNewAiConversation: boolean;
}

export interface RecipientContext {
  actorMemberId: string | null;
  assignedAgentId: string | null;
  senderMemberId: string | null;
  members: MemberPrefs[];
}

/** Un socket abierto: se suprime el aviso solo si este miembro está viendo el chat. */
export interface PresenceEntry {
  memberId: string;
  conversationId: string | null;
  visible: boolean;
}

export type PresenceMap = ReadonlyMap<string, PresenceEntry>;

/** Recorta a 80 caracteres, con "…" si no cabe. */
export function truncatePreview(text: string, max = 80): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function buildPushPayload(
  kind: NotificationKind,
  contact: PushContact,
  preview: string | null,
  conversationId: string,
  tenantId: string,
  basePath: string,
): PushPayload {
  const title = contact.displayName?.trim() || contact.externalId;
  const body =
    kind === 'assigned'
      ? 'Te asignaron esta conversación'
      : kind === 'send_failed'
        ? 'No se pudo enviar tu mensaje'
        : truncatePreview(preview ?? '');
  const prefix = basePath === '/' ? '' : basePath;
  return {
    title,
    body,
    tag: conversationId,
    url: `${prefix}/conversations/${conversationId}`,
    tenantId,
  };
}

/** Destinatarios según los interruptores vigentes. No incluye a quien hizo la acción. */
export function resolveRecipients(kind: NotificationKind, ctx: RecipientContext): string[] {
  const member = (id: string | null) => (id ? ctx.members.find((item) => item.id === id) : undefined);

  switch (kind) {
    case 'assigned': {
      const target = member(ctx.assignedAgentId);
      if (!target || target.id === ctx.actorMemberId || !target.notifyAssigned) return [];
      return [target.id];
    }
    case 'customer_message': {
      const agent = member(ctx.assignedAgentId);
      if (!agent || !agent.notifyCustomerMessage) return [];
      return [agent.id];
    }
    case 'send_failed': {
      const sender = member(ctx.senderMemberId);
      if (!sender || !sender.notifySendFailed) return [];
      return [sender.id];
    }
    case 'new_ai_conversation':
      return ctx.members
        .filter(
          (item) =>
            (item.role === 'OWNER' || item.role === 'ADMIN') && item.notifyNewAiConversation,
        )
        .map((item) => item.id);
  }
}

/**
 * Solo `customer_message` se calla, y solo si algún socket de ese miembro tiene el chat abierto
 * y la pestaña visible. El resto de avisos siempre se envían.
 */
export function shouldSuppress(
  kind: NotificationKind,
  memberId: string,
  conversationId: string,
  presence: PresenceMap,
): boolean {
  if (kind !== 'customer_message') return false;
  for (const entry of presence.values()) {
    if (
      entry.memberId === memberId &&
      entry.visible &&
      entry.conversationId === conversationId
    ) {
      return true;
    }
  }
  return false;
}
