import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NoopMetrics } from '../../observability/testing/noop-metrics';
import type { ActorContext } from '../../../shared/application/request-context';
import {
  InMemoryConversations,
  InMemoryEventInbox,
  InMemoryOutbox,
  noTransaction,
} from '../testing/in-memory';
import type { Conversation } from '../domain/conversation';
import { customerMessage } from '../domain/message';
import { RetryFailedMessageUseCase } from './retry-failed-message.use-case';
import { SendAgentMessageUseCase } from './send-agent-message.use-case';
import { UpdateDeliveryStatusUseCase } from './update-delivery-status.use-case';

const laura: ActorContext = { userId: 'u-laura', tenantId: 't1', memberId: 'laura', role: 'AGENT' };
const mateo: ActorContext = { userId: 'u-mateo', tenantId: 't1', memberId: 'mateo', role: 'AGENT' };
const owner: ActorContext = { userId: 'u-owner', tenantId: 't1', memberId: 'owner', role: 'OWNER' };
const integration = { tenantId: 't1', channelId: 'c1' };
const CLIENT_ID = '0199c0de-0000-7000-8000-000000000001';

let conversations: InMemoryConversations;
let outbox: InMemoryOutbox;
let conversation: Conversation;

beforeEach(async () => {
  conversations = new InMemoryConversations();
  outbox = new InMemoryOutbox();
  conversations.memberNames.set('laura', 'Laura');
  conversation = await conversations.createOpen({
    tenantId: 't1',
    channelId: 'c1',
    contactId: 'k1',
    at: new Date('2026-10-12T10:00:00.000Z'),
    preview: 'Hola',
  });
  conversation.assignedAgentId = 'laura';
  conversation.lastInboundAt = new Date();
});

describe('SendAgentMessageUseCase', () => {
  const build = () => new SendAgentMessageUseCase(noTransaction, conversations, outbox);
  const input = (clientMessageId = CLIENT_ID) => ({
    conversationId: conversation.id,
    text: 'Hola, soy Laura',
    clientMessageId,
  });

  it('registra el mensaje PENDING del agente asignado', async () => {
    const result = await build().execute(laura, input());

    expect(result).toMatchObject({
      kind: 'ok',
      duplicate: false,
      message: {
        status: 'PENDING',
        senderType: 'AGENT',
        direction: 'OUTBOUND',
        sender: { id: 'laura', displayName: 'Laura' },
      },
    });
    expect(conversations.messages).toHaveLength(1);
  });

  it('encola el envío y conversation.changed (delivery) en la misma operación', async () => {
    const result = await build().execute(laura, input());
    if (result.kind !== 'ok') throw new Error('se esperaba ok');

    expect(outbox.events.map((e) => e.type)).toEqual([
      'message.send_requested',
      'conversation.changed',
    ]);
    expect(outbox.events[0]!.payload).toEqual({ messageId: result.message.id });
    expect(outbox.events[1]!.payload).toMatchObject({
      conversationId: conversation.id,
      reason: 'delivery',
    });
  });

  it('es idempotente por clientMessageId: devuelve el mismo mensaje sin crear filas ni eventos', async () => {
    const first = await build().execute(laura, input());
    const again = await build().execute(laura, input());

    expect(again).toMatchObject({ kind: 'ok', duplicate: true });
    if (first.kind !== 'ok' || again.kind !== 'ok') throw new Error('se esperaba ok');
    expect(again.message.id).toBe(first.message.id);
    expect(conversations.messages).toHaveLength(1);
    expect(outbox.events).toHaveLength(2);
  });

  it('un agente que no ve la conversación recibe not-found', async () => {
    expect(await build().execute(mateo, input())).toEqual({ kind: 'not-found' });
    expect(conversations.messages).toHaveLength(0);
  });

  it('un supervisor que la ve sin estar asignado recibe forbidden', async () => {
    expect(await build().execute(owner, input())).toEqual({ kind: 'forbidden' });
  });

  it('una conversación sin agente asignado es forbidden también para un supervisor', async () => {
    conversation.assignedAgentId = null;

    expect(await build().execute(owner, input())).toEqual({ kind: 'forbidden' });
  });

  it('en una conversación cerrada rechaza con INVALID_STATE', async () => {
    conversation.status = 'CLOSED';

    expect(await build().execute(laura, input())).toEqual({
      kind: 'rejected',
      reason: 'INVALID_STATE',
    });
    expect(outbox.events).toHaveLength(0);
  });

  it('pasadas 18 h del último mensaje del cliente rechaza con WINDOW_CLOSED', async () => {
    conversation.lastInboundAt = new Date(Date.now() - 19 * 3_600_000);

    expect(await build().execute(laura, input())).toEqual({
      kind: 'rejected',
      reason: 'WINDOW_CLOSED',
    });
    expect(outbox.events).toHaveLength(0);
  });

  it('un mensaje entrante reabre la ventana', async () => {
    conversation.lastInboundAt = new Date(Date.now() - 19 * 3_600_000);
    await conversations.appendMessage(
      conversation,
      customerMessage('Sigo aquí', 'wamid-reopen', new Date()),
      new Date(),
    );

    expect((await build().execute(laura, input())).kind).toBe('ok');
  });
});

describe('RetryFailedMessageUseCase', () => {
  let messageId: string;
  const build = () => new RetryFailedMessageUseCase(noTransaction, conversations, outbox);

  beforeEach(async () => {
    const sent = await new SendAgentMessageUseCase(noTransaction, conversations, outbox).execute(
      laura,
      { conversationId: conversation.id, text: 'Hola', clientMessageId: CLIENT_ID },
    );
    if (sent.kind !== 'ok') throw new Error('se esperaba ok');
    messageId = sent.message.id;
    outbox.events.length = 0;
  });

  const fail = () => {
    const stored = conversations.messages[0]!;
    stored.status = 'FAILED';
    stored.failureReason = 'sin red';
  };

  it('devuelve un mensaje FAILED a PENDING, borra el motivo y encola un nuevo envío', async () => {
    fail();

    const result = await build().execute(laura, { conversationId: conversation.id, messageId });

    expect(result).toMatchObject({
      kind: 'ok',
      message: { status: 'PENDING', failureReason: null },
    });
    expect(outbox.events.map((e) => e.type)).toEqual([
      'message.send_requested',
      'conversation.changed',
    ]);
  });

  it.each(['PENDING', 'SENT', 'DELIVERED', 'READ'] as const)(
    'un mensaje %s responde INVALID_STATE',
    async (status) => {
      conversations.messages[0]!.status = status;

      expect(await build().execute(laura, { conversationId: conversation.id, messageId })).toEqual({
        kind: 'rejected',
        reason: 'INVALID_STATE',
      });
      expect(outbox.events).toHaveLength(0);
    },
  );

  it('pasadas 18 h no reintenta', async () => {
    fail();
    conversation.lastInboundAt = new Date(Date.now() - 19 * 3_600_000);

    expect(await build().execute(laura, { conversationId: conversation.id, messageId })).toEqual({
      kind: 'rejected',
      reason: 'WINDOW_CLOSED',
    });
    expect(outbox.events).toHaveLength(0);
  });

  it('solo reintenta el agente asignado', async () => {
    fail();

    expect(await build().execute(owner, { conversationId: conversation.id, messageId })).toEqual({
      kind: 'forbidden',
    });
    expect(await build().execute(mateo, { conversationId: conversation.id, messageId })).toEqual({
      kind: 'not-found',
    });
  });

  it('un mensaje desconocido es not-found', async () => {
    expect(
      await build().execute(laura, {
        conversationId: conversation.id,
        messageId: '0199c0de-0000-7000-8000-0000000000ff',
      }),
    ).toEqual({ kind: 'not-found' });
  });
});

describe('UpdateDeliveryStatusUseCase', () => {
  let messageId: string;
  let inbox: InMemoryEventInbox;
  let useCase: UpdateDeliveryStatusUseCase;

  const report = (status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED', error?: string) =>
    useCase.execute(integration, {
      messageId,
      providerMessageId: 'sim-1',
      status,
      occurredAt: new Date(),
      ...(error && { error }),
    });

  beforeEach(async () => {
    inbox = new InMemoryEventInbox();
    useCase = new UpdateDeliveryStatusUseCase(noTransaction, conversations, inbox, outbox);
    const sent = await new SendAgentMessageUseCase(noTransaction, conversations, outbox).execute(
      laura,
      { conversationId: conversation.id, text: 'Hola', clientMessageId: CLIENT_ID },
    );
    if (sent.kind !== 'ok') throw new Error('se esperaba ok');
    messageId = sent.message.id;
    outbox.events.length = 0;
  });

  it('aplica SENT, guarda el providerMessageId y encola conversation.changed (delivery)', async () => {
    expect(await report('SENT')).toEqual({ kind: 'ok', applied: true, status: 'SENT' });

    expect(conversations.messages[0]).toMatchObject({ status: 'SENT', externalId: 'sim-1' });
    expect(outbox.events).toHaveLength(1);
    expect(outbox.events[0]!.payload).toMatchObject({ reason: 'delivery' });
  });

  it('un reporte repetido responde applied: false y no encola nada', async () => {
    await report('SENT');
    outbox.events.length = 0;

    expect(await report('SENT')).toEqual({ kind: 'ok', applied: false, status: 'SENT' });
    expect(outbox.events).toHaveLength(0);
    expect(inbox.recorded.size).toBe(1);
  });

  it('cuenta cada reporte con su estado y si se aplicó', async () => {
    const metrics = new NoopMetrics();
    const update = vi.spyOn(metrics, 'deliveryStatusUpdate');
    useCase = new UpdateDeliveryStatusUseCase(noTransaction, conversations, inbox, outbox, metrics);

    await report('DELIVERED');
    await report('DELIVERED');

    expect(update.mock.calls).toEqual([
      ['DELIVERED', true],
      ['DELIVERED', false],
    ]);
  });

  it('READ y después DELIVERED deja el mensaje en READ', async () => {
    await report('READ');

    expect(await report('DELIVERED')).toEqual({ kind: 'ok', applied: false, status: 'READ' });
    expect(conversations.messages[0]!.status).toBe('READ');
  });

  it('FAILED guarda el motivo; un FAILED tardío no pisa un READ', async () => {
    await report('FAILED', 'número inválido');
    expect(conversations.messages[0]).toMatchObject({
      status: 'FAILED',
      failureReason: 'número inválido',
    });

    conversations.messages[0]!.status = 'READ';
    expect(await report('FAILED')).toMatchObject({ applied: false, status: 'READ' });
  });

  it('un mensaje de otro canal es not-found', async () => {
    expect(
      await useCase.execute(
        { tenantId: 't1', channelId: 'otro' },
        { messageId, providerMessageId: 'x', status: 'SENT', occurredAt: new Date() },
      ),
    ).toEqual({ kind: 'not-found' });
  });

  it('un mensaje entrante del cliente es not-found', async () => {
    const inboundMessage = await conversations.appendMessage(
      conversation,
      {
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        status: 'RECEIVED',
        text: 'Hola',
        externalId: 'wamid.1',
      },
      new Date(),
    );

    expect(
      await useCase.execute(integration, {
        messageId: inboundMessage.id,
        providerMessageId: 'x',
        status: 'READ',
        occurredAt: new Date(),
      }),
    ).toEqual({ kind: 'not-found' });
  });

  it('applyInternal no deduplica: FAILED → SENT tras un reintento manual se aplica', async () => {
    await useCase.applyInternal(integration, {
      messageId,
      providerMessageId: 'sim-1',
      status: 'SENT',
      occurredAt: new Date(),
    });
    conversations.messages[0]!.status = 'FAILED';

    const result = await useCase.applyInternal(integration, {
      messageId,
      providerMessageId: 'sim-1',
      status: 'SENT',
      occurredAt: new Date(),
    });

    expect(result).toEqual({ kind: 'ok', applied: true, status: 'SENT' });
    expect(inbox.recorded.size).toBe(0);
  });
});
