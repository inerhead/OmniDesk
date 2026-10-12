import { randomUUID } from 'node:crypto';
import { UniqueConflictError } from '../../../shared/application/errors';
import type { OutboxPort } from '../../../shared/application/outbox.port';
import type { TransactionRunner } from '../../../shared/application/transaction-runner.port';
import type { ContactRepository } from '../../contacts/application/ports/contact.repository';
import type { Contact } from '../../contacts/domain/contact';
import type { MemberRepository } from '../../members/application/ports/member.repository';
import type { Member, NewMember } from '../../members/domain/member';
import type {
  ConversationRepository,
  NewConversation,
} from '../application/ports/conversation.repository';
import { appendMessage, type Conversation } from '../domain/conversation';
import type { ConversationEvent, NewConversationEvent } from '../domain/conversation-event';
import type { ConversationState } from '../domain/conversation-transitions';
import type { Message, NewMessage } from '../domain/message';

/** Dobles en memoria para las pruebas unitarias de los casos de uso. */

export const noTransaction: TransactionRunner = { run: (work) => work() };

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
  readonly messages: (Message & NewMessage & { channelId: string })[] = [];
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
    };
    this.conversations.push(conversation);
    if (this.raceOnNextCreate) {
      this.raceOnNextCreate = false;
      throw new UniqueConflictError('conversations_one_open_per_contact');
    }
    return conversation;
  }

  async appendMessage(conversation: Conversation, message: NewMessage, at: Date) {
    Object.assign(conversation, appendMessage(conversation, message.text, at));
    const stored = {
      ...message,
      id: randomUUID(),
      channelId: conversation.channelId,
      conversationId: conversation.id,
      sequence: conversation.lastSequence,
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

  add(member: Partial<Member> & Pick<Member, 'id' | 'role'>): Member {
    const stored: Member = {
      tenantId: 't1',
      displayName: member.id,
      email: `${member.id}@demo.omnidesk.local`,
      ...member,
    };
    this.members.push(stored);
    return stored;
  }

  async upsertByEmail(tenantId: string, data: NewMember) {
    return this.add({ id: randomUUID(), tenantId, ...data });
  }

  async findById(tenantId: string, id: string) {
    return this.members.find((m) => m.id === id && m.tenantId === tenantId) ?? null;
  }

  async list(tenantId: string) {
    return this.members.filter((m) => m.tenantId === tenantId);
  }
}
