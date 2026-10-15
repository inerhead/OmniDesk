import { TENANT_INACTIVE_REASON } from '@omnidesk/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Conversation } from '../domain/conversation';
import { InMemoryConversations, InMemoryOutbox } from '../testing/in-memory';
import { RequeueTenantInactiveUseCase } from './requeue-tenant-inactive.use-case';

const now = new Date('2026-10-14T12:00:00.000Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);

let conversations: InMemoryConversations;
let outbox: InMemoryOutbox;

async function failedIn(
  conversation: Conversation,
  reason: string = TENANT_INACTIVE_REASON,
): Promise<string> {
  const message = await conversations.appendMessage(
    conversation,
    { direction: 'OUTBOUND', senderType: 'AGENT', text: 'Hola', status: 'PENDING' },
    hoursAgo(1),
  );
  await conversations.updateMessageDelivery(message.id, {
    status: 'FAILED',
    failureReason: reason,
    at: hoursAgo(1),
  });
  return message.id;
}

async function open(contactId: string, lastInboundAt: Date): Promise<Conversation> {
  const conversation = await conversations.createOpen({
    tenantId: 't1',
    channelId: 'c1',
    contactId,
    at: lastInboundAt,
    preview: 'Hola',
  });
  conversation.lastInboundAt = lastInboundAt;
  return conversation;
}

const statusOf = (id: string) => conversations.messages.find((m) => m.id === id)?.status;

describe('RequeueTenantInactiveUseCase', () => {
  beforeEach(() => {
    conversations = new InMemoryConversations();
    outbox = new InMemoryOutbox();
  });

  it('reencola los TENANT_INACTIVE con la conversación abierta y la ventana abierta', async () => {
    const conversation = await open('k1', hoursAgo(2));
    const id = await failedIn(conversation);

    const requeued = await new RequeueTenantInactiveUseCase(
      conversations,
      outbox,
    ).requeueTenantInactive('t1', now);

    expect(requeued).toBe(1);
    expect(statusOf(id)).toBe('PENDING');
    expect(outbox.events.map((event) => event.type)).toEqual([
      'message.send_requested',
      'conversation.changed',
    ]);
  });

  it('deja FAILED los de ventana cerrada, conversación cerrada u otro motivo', async () => {
    const stale = await failedIn(await open('k1', hoursAgo(19)));
    const closedConversation = await open('k2', hoursAgo(2));
    const inClosed = await failedIn(closedConversation);
    closedConversation.status = 'CLOSED';
    const other = await failedIn(await open('k3', hoursAgo(2)), 'CHANNEL_NOT_CONFIGURED');

    const requeued = await new RequeueTenantInactiveUseCase(
      conversations,
      outbox,
    ).requeueTenantInactive('t1', now);

    expect(requeued).toBe(0);
    expect([statusOf(stale), statusOf(inClosed), statusOf(other)]).toEqual([
      'FAILED',
      'FAILED',
      'FAILED',
    ]);
    expect(outbox.events).toEqual([]);
  });
});
