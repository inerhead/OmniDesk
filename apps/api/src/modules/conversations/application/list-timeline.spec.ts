import { describe, expect, it } from 'vitest';
import type { ActorContext } from '../../../shared/application/request-context';
import type { Message } from '../domain/message';
import { ListTimelineUseCase } from './list-timeline.use-case';
import type { ConversationEventView, ConversationReadModel } from './ports/conversation-read-model';

const owner: ActorContext = { userId: 'u-owner', tenantId: 't1', memberId: 'owner', role: 'OWNER' };
const laura: ActorContext = { userId: 'u-laura', tenantId: 't1', memberId: 'laura', role: 'AGENT' };

const message = (sequence: number): Message => ({
  id: `m${sequence}`,
  conversationId: 'c1',
  channelId: 'ch1',
  sequence,
  direction: 'INBOUND',
  senderType: 'CUSTOMER',
  text: `mensaje ${sequence}`,
  status: 'RECEIVED',
  externalId: null,
  sender: null,
  failureReason: null,
  attachment: null,
  createdAt: new Date(2026, 9, 12, 10, sequence),
});

const event = (sequence: number): ConversationEventView => ({
  id: `e${sequence}`,
  sequence,
  type: 'ASSIGNED',
  actor: { id: 'owner', displayName: 'Sup. Demo' },
  target: { id: 'laura', displayName: 'Laura' },
  createdAt: new Date(2026, 9, 12, 10, sequence),
});

/** Mensajes en 1, 2, 4, 6 y eventos en 3, 5, 7. */
function readModel(access: { status: 'OPEN' | 'CLOSED'; assignedAgentId: string | null } | null) {
  const messages = [1, 2, 4, 6].map(message);
  const events = [3, 5, 7].map(event);
  const page = <T extends { sequence: number }>(items: T[], before: number | null, take: number) =>
    items
      .filter((item) => before === null || item.sequence < before)
      .sort((a, b) => b.sequence - a.sequence)
      .slice(0, take);
  return {
    findAccess: async () => access,
    listMessagesDescending: async (_id: string, before: number | null, take: number) =>
      page(messages, before, take),
    listEventsDescending: async (_id: string, before: number | null, take: number) =>
      page(events, before, take),
  } as unknown as ConversationReadModel;
}

describe('ListTimelineUseCase', () => {
  const open = { status: 'OPEN' as const, assignedAgentId: null };

  it('intercala mensajes y eventos en orden ascendente por sequence', async () => {
    const page = await new ListTimelineUseCase(readModel(open)).execute(owner, 'c1', undefined, 50);

    expect(page?.items.map((i) => `${i.kind}:${i.sequence}`)).toEqual([
      'message:1',
      'message:2',
      'event:3',
      'message:4',
      'event:5',
      'message:6',
      'event:7',
    ]);
    expect(page?.prevCursor).toBeNull();
  });

  it('pagina desde el final: la primera página trae lo más reciente y prevCursor', async () => {
    const useCase = new ListTimelineUseCase(readModel(open));

    const first = await useCase.execute(owner, 'c1', undefined, 3);

    expect(first?.items.map((i) => i.sequence)).toEqual([5, 6, 7]);
    expect(first?.prevCursor).toBe(5);
  });

  it('before continúa justo donde terminó la página, con un evento en el borde', async () => {
    const useCase = new ListTimelineUseCase(readModel(open));

    const second = await useCase.execute(owner, 'c1', 5, 3);
    expect(second?.items.map((i) => i.sequence)).toEqual([2, 3, 4]);
    expect(second?.prevCursor).toBe(2);

    const third = await useCase.execute(owner, 'c1', 2, 3);
    expect(third?.items.map((i) => i.sequence)).toEqual([1]);
    expect(third?.prevCursor).toBeNull();
  });

  it('un AGENT no ve la línea de tiempo de una conversación asignada a otro', async () => {
    const assignedToMateo = readModel({ status: 'OPEN', assignedAgentId: 'mateo' });

    expect(
      await new ListTimelineUseCase(assignedToMateo).execute(laura, 'c1', undefined, 50),
    ).toBeNull();
    expect(
      await new ListTimelineUseCase(assignedToMateo).execute(owner, 'c1', undefined, 50),
    ).not.toBeNull();
  });

  it('devuelve null si la conversación no existe', async () => {
    expect(
      await new ListTimelineUseCase(readModel(null)).execute(owner, 'c1', undefined, 50),
    ).toBeNull();
  });
});
