import { Inject, Injectable } from '@nestjs/common';
import type { Inbox, InboxCountsResponse } from '@omnidesk/contracts';
import type { ActorContext } from '../../../shared/application/request-context';
import { canViewInbox } from '../domain/conversation-policy';
import { inboxFilter } from './inbox-filter';
import {
  CONVERSATION_READ_MODEL,
  type ConversationReadModel,
} from './ports/conversation-read-model';

/** Bandejas con contador; `closed` no se cuenta (el histórico solo crece). */
const COUNTED: Array<Exclude<Inbox, 'closed'>> = ['ai', 'mine', 'all'];

/** Conversaciones por bandeja con el mismo filtro que la lista (`inboxFilter`), sin la búsqueda. */
@Injectable()
export class CountInboxesUseCase {
  constructor(@Inject(CONVERSATION_READ_MODEL) private readonly readModel: ConversationReadModel) {}

  async execute(actor: ActorContext, channelId?: string): Promise<InboxCountsResponse> {
    const visible = COUNTED.filter((inbox) => canViewInbox(actor, inbox));
    const counts = await Promise.all(
      visible.map((inbox) =>
        this.readModel.countConversations(
          actor.tenantId,
          inboxFilter(actor, inbox, undefined, channelId),
        ),
      ),
    );
    return Object.fromEntries(
      visible.map((inbox, index) => [inbox, counts[index]!]),
    ) as InboxCountsResponse;
  }
}
