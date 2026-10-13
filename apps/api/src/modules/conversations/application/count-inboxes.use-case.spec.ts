import { describe, expect, it } from 'vitest';
import type { ActorContext } from '../../../shared/application/request-context';
import { CountInboxesUseCase } from './count-inboxes.use-case';
import type { ConversationFilter, ConversationReadModel } from './ports/conversation-read-model';

const owner: ActorContext = { userId: 'u-owner', tenantId: 't1', memberId: 'owner', role: 'OWNER' };
const laura: ActorContext = { userId: 'u-laura', tenantId: 't1', memberId: 'laura', role: 'AGENT' };

/** Cuenta según el filtro: 3 sin asignar, 2 del actor, 7 abiertas en total. */
function fakeReadModel() {
  const filters: ConversationFilter[] = [];
  const readModel = {
    countConversations: async (_tenantId: string, filter: ConversationFilter) => {
      filters.push(filter);
      if (filter.assignedAgentId === null) return 3;
      if (filter.assignedAgentId) return 2;
      return 7;
    },
  } as unknown as ConversationReadModel;
  return { readModel, filters };
}

describe('CountInboxesUseCase', () => {
  it('OWNER/ADMIN: sin asignar, mías y todas', async () => {
    const { readModel } = fakeReadModel();
    const counts = await new CountInboxesUseCase(readModel).execute(owner);
    expect(counts).toEqual({ ai: 3, mine: 2, all: 7 });
  });

  it('AGENT: sin `all`, como en la lista', async () => {
    const { readModel, filters } = fakeReadModel();
    const counts = await new CountInboxesUseCase(readModel).execute(laura);
    expect(counts).toEqual({ ai: 3, mine: 2 });
    expect(filters).toHaveLength(2);
  });

  it('el canal se aplica a cada bandeja', async () => {
    const { readModel, filters } = fakeReadModel();
    await new CountInboxesUseCase(readModel).execute(laura, 'canal-1');
    expect(filters).toEqual([
      { status: 'OPEN', assignedAgentId: null, channelId: 'canal-1' },
      { status: 'OPEN', assignedAgentId: 'laura', channelId: 'canal-1' },
    ]);
  });
});
