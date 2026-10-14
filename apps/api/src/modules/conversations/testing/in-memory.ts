import { randomUUID } from 'node:crypto';
import { UniqueConflictError } from '../../../shared/application/errors';
import type { OutboxPort } from '../../../shared/application/outbox.port';
import type { TransactionRunner } from '../../../shared/application/transaction-runner.port';
import type { ContactRepository } from '../../contacts/application/ports/contact.repository';
import type { Contact } from '../../contacts/domain/contact';
import type { MemberRepository } from '../../members/application/ports/member.repository';
import type { Member, NewMember } from '../../members/domain/member';
import type { EventInbox } from '../application/ports/event-inbox';
import type {
  ConversationRepository,
  MessageDeliveryUpdate,
  NewConversation,
  OutboundForSend,
} from '../application/ports/conversation.repository';
import { appendMessage, type Conversation } from '../domain/conversation';
import type { ConversationEvent, NewConversationEvent } from '../domain/conversation-event';
import type { ConversationState } from '../domain/conversation-transitions';
import { previewSource, type Message, type NewMessage } from '../domain/message';

/** Dobles en memoria para las pruebas unitarias de los casos de uso. */

export const noTransaction: TransactionRunner = {
  run: (work) => work(),
  runDetached: (work) => work(),
};

export class InMemoryOutbox implements OutboxPort {
  readonly events: Parameters<OutboxPort['enqueue']>[0][] = [];

  async enqueue(event: Parameters<OutboxPort['enqueue']>[0]) {
    this.events.push(event);
  }
}

export class InMemoryContacts implements ContactRepository {
  readonly byPhone = new Map<string, Contact>();

  async findOrCreateByIdentity(
    identity: { tenantId: string; externalId: string },
    displayName?: string,
  ) {
    const found = this.byPhone.get(identity.externalId);
    if (found) return found;
    const contact = {
      id: randomUUID(),
      tenantId: identity.tenantId,
      displayName: displayName ?? null,
    };
    this.byPhone.set(identity.externalId, contact);
    return contact;
  }
}

export class InMemoryConversations implements ConversationRepository {
  readonly conversations: Conversation[] = [];
  readonly messages: (Message & Omit<NewMessage, 'externalId' | 'attachment'>)[] = [];
  /** Nombres de los agentes remitentes, por id de miembro. */
  readonly memberNames = new Map<string, string>();
  /** Teléfono del destinatario de cada conversación (para `findOutboundForSend`). */
  readonly phones = new Map<string, string>();
  readonly events: ConversationEvent[] = [];
  /** Simula que otra transacción creó la conversación a la vez la próxima vez que se llame a createOpen. */
  raceOnNextCreate = false;

  async findById(tenantId: string, id: string) {
    return this.conversations.find((c) => c.id === id && c.tenantId === tenantId) ?? null;
  }

  findByIdForUpdate(tenantId: string, id: string) {
    return this.findById(tenantId, id);
  }

  async findOpen(channelId: string, contactId: string) {
    return (
      this.conversations.find(
        (c) => c.channelId === channelId && c.contactId === contactId && c.status === 'OPEN',
      ) ?? null
    );
  }

  async findLatestClosed(channelId: string, contactId: string) {
    return (
      this.conversations
        .filter(
          (c) => c.channelId === channelId && c.contactId === contactId && c.status === 'CLOSED',
        )
        .at(-1) ?? null
    );
  }

  async createOpen(data: NewConversation) {
    const conversation: Conversation = {
      id: randomUUID(),
      tenantId: data.tenantId,
      channelId: data.channelId,
      contactId: data.contactId,
      status: 'OPEN',
      assignedAgentId: null,
      controlVersion: 0,
      lastSequence: 0,
      lastMessageAt: data.at,
      lastMessagePreview: data.preview,
      lastInboundAt: null,
    };
    this.conversations.push(conversation);
    if (this.raceOnNextCreate) {
      this.raceOnNextCreate = false;
      throw new UniqueConflictError('conversations_one_open_per_contact');
    }
    return conversation;
  }

  async appendMessage(conversation: Conversation, message: NewMessage, at: Date) {
    Object.assign(conversation, appendMessage(conversation, previewSource(message), at));
    if (message.direction === 'INBOUND') conversation.lastInboundAt = at;
    const { attachment, ...fields } = message;
    const stored = {
      ...fields,
      id: randomUUID(),
      channelId: conversation.channelId,
      conversationId: conversation.id,
      sequence: conversation.lastSequence,
      externalId: message.externalId ?? null,
      sender: message.senderMemberId
        ? {
            id: message.senderMemberId,
            displayName: this.memberNames.get(message.senderMemberId) ?? message.senderMemberId,
          }
        : null,
      failureReason: null,
      attachment: attachment
        ? {
            id: randomUUID(),
            kind: attachment.kind,
            mimeType: attachment.mimeType,
            fileName: attachment.fileName ?? null,
            sizeBytes: attachment.sizeBytes ?? null,
            voice: attachment.voice ?? false,
            status: attachment.status,
            storageKey: attachment.storageKey ?? null,
          }
        : null,
      createdAt: at,
    };
    this.messages.push(stored);
    return stored;
  }

  async applyTransition(conversation: Conversation, next: ConversationState) {
    Object.assign(conversation, next, { controlVersion: conversation.controlVersion + 1 });
    return conversation;
  }

  async appendEvent(conversation: Conversation, event: NewConversationEvent, at: Date) {
    conversation.lastSequence += 1;
    const stored: ConversationEvent = {
      ...event,
      id: randomUUID(),
      conversationId: conversation.id,
      sequence: conversation.lastSequence,
      createdAt: at,
    };
    this.events.push(stored);
    return stored;
  }

  async findMessageById(tenantId: string, messageId: string) {
    const message = this.messages.find((m) => m.id === messageId) ?? null;
    const conversation = message && (await this.findById(tenantId, message.conversationId));
    return conversation ? message : null;
  }

  async findMessageByClientId(conversationId: string, clientMessageId: string) {
    return (
      this.messages.find(
        (m) => m.conversationId === conversationId && m.clientMessageId === clientMessageId,
      ) ?? null
    );
  }

  async findOutboundForSend(tenantId: string, messageId: string): Promise<OutboundForSend | null> {
    const message = await this.findMessageById(tenantId, messageId);
    if (!message || message.direction !== 'OUTBOUND') return null;
    return { message, tenantId, to: this.phones.get(message.conversationId) ?? '+573001234567' };
  }

  async updateMessageDelivery(messageId: string, update: MessageDeliveryUpdate) {
    const message = this.messages.find((m) => m.id === messageId);
    if (!message) throw new Error(`sin mensaje ${messageId}`);
    message.status = update.status;
    message.failureReason = update.failureReason;
    if (update.externalId !== undefined) message.externalId = update.externalId;
    return message;
  }

  async findMessageByExternalId(channelId: string, externalId: string) {
    return (
      this.messages.find((m) => m.channelId === channelId && m.externalId === externalId) ?? null
    );
  }

  async findMessageByIdempotencyKey(conversationId: string, idempotencyKey: string) {
    return (
      this.messages.find(
        (m) => m.conversationId === conversationId && m.idempotencyKey === idempotencyKey,
      ) ?? null
    );
  }
}

export class InMemoryMembers implements MemberRepository {
  readonly members: Member[] = [];
  readonly removed = new Map<string, Date>();
  readonly userIds = new Map<string, string | null>();
  ownerLocks = 0;

  add(member: Partial<Member> & Pick<Member, 'id' | 'role'> & { userId?: string }): Member {
    const { userId, ...rest } = member;
    const stored: Member = {
      tenantId: 't1',
      displayName: member.id,
      email: `${member.id}@demo.omnidesk.local`,
      ...rest,
    };
    this.members.push(stored);
    this.userIds.set(stored.id, userId ?? null);
    return stored;
  }

  private active(tenantId: string) {
    return this.members.filter((m) => m.tenantId === tenantId && !this.removed.has(m.id));
  }

  async upsertByEmail(tenantId: string, data: NewMember) {
    return this.add({ id: randomUUID(), tenantId, ...data });
  }

  async findById(tenantId: string, id: string) {
    return this.active(tenantId).find((m) => m.id === id) ?? null;
  }

  async list(tenantId: string) {
    return this.active(tenantId);
  }

  async findActiveByEmail(tenantId: string, email: string) {
    return this.active(tenantId).find((m) => m.email === email.toLowerCase()) ?? null;
  }

  async admit(tenantId: string, data: Required<NewMember>) {
    const existing = this.members.find((m) => m.tenantId === tenantId && m.email === data.email);
    if (!existing) return this.add({ id: randomUUID(), tenantId, ...data });
    Object.assign(existing, { displayName: data.displayName, role: data.role });
    this.removed.delete(existing.id);
    this.userIds.set(existing.id, data.userId);
    return existing;
  }

  async lockOwners(tenantId: string) {
    this.ownerLocks += 1;
    return this.active(tenantId)
      .filter((m) => m.role === 'OWNER')
      .map((m) => m.id);
  }

  async updateRole(tenantId: string, id: string, role: Member['role']) {
    const member = (await this.findById(tenantId, id))!;
    member.role = role;
    return member;
  }

  async markRemoved(tenantId: string, id: string, at: Date) {
    this.removed.set(id, at);
    return { userId: this.userIds.get(id) ?? null };
  }
}

export class InMemoryEventInbox implements EventInbox {
  readonly recorded = new Set<string>();

  async recordIfNew(channelId: string, externalId: string) {
    const key = `${channelId}|${externalId}`;
    if (this.recorded.has(key)) return false;
    this.recorded.add(key);
    return true;
  }
}
