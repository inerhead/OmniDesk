import { beforeEach, describe, expect, it } from 'vitest';
import {
  InMemoryContacts,
  InMemoryConversations,
  InMemoryOutbox,
  noTransaction,
} from '../testing/in-memory';
import { RegisterAiReplyUseCase } from './register-ai-reply.use-case';
import { RegisterInboundMessageUseCase } from './register-inbound-message.use-case';

const integration = { tenantId: 't1', channelId: 'c1' };

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

  it('reabre una conversación cerrada: misma conversación, REOPENED sin actor y aiAllowed true', async () => {
    const first = await useCase.execute(integration, inbound('m1'));
    const conversation = conversations.conversations[0]!;
    Object.assign(conversation, { status: 'CLOSED', assignedAgentId: 'laura', controlVersion: 3 });

    const again = await useCase.execute(integration, inbound('m2'));

    expect(again).toMatchObject({
      conversationId: first.conversationId,
      aiAllowed: true,
      controlVersion: 4,
      duplicate: false,
    });
    expect(conversations.conversations).toHaveLength(1);
    expect(conversation).toMatchObject({ status: 'OPEN', assignedAgentId: null });
    expect(conversations.events).toEqual([
      expect.objectContaining({ type: 'REOPENED', actorMemberId: null, targetMemberId: null }),
    ]);
    // El evento va antes del mensaje que lo provocó, en la misma línea de tiempo.
    expect(conversations.events[0]!.sequence).toBe(2);
    expect(conversations.messages.at(-1)!.sequence).toBe(3);
  });

  it('con la conversación asignada devuelve aiAllowed false y el controlVersion vigente', async () => {
    const first = await useCase.execute(integration, inbound('m1'));
    Object.assign(conversations.conversations[0]!, { assignedAgentId: 'laura', controlVersion: 1 });

    const again = await useCase.execute(integration, inbound('m2'));

    expect(again).toMatchObject({
      conversationId: first.conversationId,
      aiAllowed: false,
      controlVersion: 1,
    });
    expect(conversations.events).toHaveLength(0);
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
