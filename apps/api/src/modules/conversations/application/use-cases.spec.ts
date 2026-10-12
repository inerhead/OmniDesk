import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { UniqueConflictError } from '../../../shared/application/errors';
import type { OutboxPort } from '../../../shared/application/outbox.port';
import type { TransactionRunner } from '../../../shared/application/transaction-runner.port';
import type { ContactRepository } from '../../contacts/application/ports/contact.repository';
import type { Contact } from '../../contacts/domain/contact';
import { appendMessage, type Conversation } from '../domain/conversation';
import type { Message, NewMessage } from '../domain/message';
import type { ConversationRepository, NewConversation } from './ports/conversation.repository';
import { RegisterAiReplyUseCase } from './register-ai-reply.use-case';
import { RegisterInboundMessageUseCase } from './register-inbound-message.use-case';

const integration = { tenantId: 't1', channelId: 'c1' };
const noTransaction: TransactionRunner = { run: (work) => work() };

class InMemoryOutbox implements OutboxPort {
  readonly events: Parameters<OutboxPort['enqueue']>[0][] = [];

  async enqueue(event: Parameters<OutboxPort['enqueue']>[0]) {
    this.events.push(event);
  }
}

class InMemoryContacts implements ContactRepository {
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

class InMemoryConversations implements ConversationRepository {
  readonly conversations: Conversation[] = [];
  readonly messages: (Message & NewMessage & { channelId: string })[] = [];
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

const inbound = (externalMessageId: string, phone = '+573001234567') => ({
  externalMessageId,
  from: { externalId: phone, displayName: 'Ana' },
  text: 'Hola',
  sentAt: new Date('2026-10-12T10:00:00.000Z'),
});

describe('RegisterInboundMessageUseCase', () => {
  let conversations: InMemoryConversations;
  let outbox: InMemoryOutbox;
  let useCase: RegisterInboundMessageUseCase;

  beforeEach(() => {
    conversations = new InMemoryConversations();
    outbox = new InMemoryOutbox();
    useCase = new RegisterInboundMessageUseCase(
      noTransaction,
      conversations,
      new InMemoryContacts(),
      outbox,
    );
  });

  it('crea la conversación y devuelve aiAllowed con controlVersion 0', async () => {
    const result = await useCase.execute(integration, inbound('m1'));

    expect(result).toMatchObject({ aiAllowed: true, controlVersion: 0, duplicate: false });
    expect(conversations.conversations).toHaveLength(1);
  });

  it('agrupa los mensajes del mismo teléfono con sequence 1 y 2', async () => {
    const first = await useCase.execute(integration, inbound('m1'));
    const second = await useCase.execute(integration, inbound('m2'));

    expect(second.conversationId).toBe(first.conversationId);
    expect(conversations.messages.map((m) => m.sequence)).toEqual([1, 2]);
  });

  it('marca como duplicado un externalMessageId repetido sin crear mensajes', async () => {
    const first = await useCase.execute(integration, inbound('m1'));
    const again = await useCase.execute(integration, inbound('m1'));

    expect(again).toMatchObject({ messageId: first.messageId, duplicate: true });
    expect(conversations.messages).toHaveLength(1);
  });

  it('encola un conversation.changed por mensaje nuevo', async () => {
    const first = await useCase.execute(integration, inbound('m1'));
    await useCase.execute(integration, inbound('m2'));

    expect(outbox.events).toHaveLength(2);
    expect(outbox.events[0]).toMatchObject({
      tenantId: 't1',
      type: 'conversation.changed',
      payload: {
        type: 'conversation.changed',
        conversationId: first.conversationId,
        reason: 'message',
      },
    });
  });

  it('no encola nada para un duplicado', async () => {
    await useCase.execute(integration, inbound('m1'));
    await useCase.execute(integration, inbound('m1'));

    expect(outbox.events).toHaveLength(1);
  });

  it('reintenta una vez si otra transacción creó la conversación a la vez', async () => {
    conversations.raceOnNextCreate = true;

    const result = await useCase.execute(integration, inbound('m1'));

    expect(result.duplicate).toBe(false);
    expect(conversations.conversations).toHaveLength(1);
  });
});

describe('RegisterAiReplyUseCase', () => {
  let conversations: InMemoryConversations;
  let outbox: InMemoryOutbox;
  let useCase: RegisterAiReplyUseCase;
  let conversationId: string;

  beforeEach(async () => {
    conversations = new InMemoryConversations();
    const inboundUseCase = new RegisterInboundMessageUseCase(
      noTransaction,
      conversations,
      new InMemoryContacts(),
      new InMemoryOutbox(),
    );
    conversationId = (await inboundUseCase.execute(integration, inbound('m1'))).conversationId;
    outbox = new InMemoryOutbox();
    useCase = new RegisterAiReplyUseCase(noTransaction, conversations, outbox);
  });

  const reply = (overrides: object = {}) => ({
    conversationId,
    controlVersion: 0,
    idempotencyKey: 'ai-1',
    text: '¡Hola! ¿En qué te ayudo?',
    ...overrides,
  });

  it('registra la respuesta como PENDING y AI', async () => {
    const result = await useCase.execute(integration, reply());

    expect(result.kind).toBe('accepted');
    expect(conversations.messages.at(-1)).toMatchObject({
      senderType: 'AI',
      status: 'PENDING',
      sequence: 2,
    });
  });

  it('encola un conversation.changed al aceptar la respuesta', async () => {
    await useCase.execute(integration, reply());

    expect(outbox.events).toHaveLength(1);
    expect(outbox.events[0]).toMatchObject({
      tenantId: 't1',
      type: 'conversation.changed',
      payload: { conversationId, reason: 'message' },
    });
  });

  it('es idempotente por idempotencyKey y no encola de nuevo', async () => {
    const first = await useCase.execute(integration, reply());
    const again = await useCase.execute(integration, reply());

    expect(again).toEqual(first);
    expect(conversations.messages).toHaveLength(2);
    expect(outbox.events).toHaveLength(1);
  });

  it('rechaza con CONTROL_CHANGED si el controlVersion no coincide', async () => {
    expect(await useCase.execute(integration, reply({ controlVersion: 99 }))).toEqual({
      kind: 'rejected',
      reason: 'CONTROL_CHANGED',
    });
    expect(outbox.events).toHaveLength(0);
  });

  it('no encuentra conversaciones de otro canal', async () => {
    expect(await useCase.execute({ ...integration, channelId: 'otro' }, reply())).toEqual({
      kind: 'not-found',
    });
  });
});
