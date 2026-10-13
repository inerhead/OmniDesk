import { Inject, Injectable } from '@nestjs/common';
import type { Inbox } from '@omnidesk/contracts';
import type { ActorContext } from '../../../shared/application/request-context';
import { decodeConversationCursor, encodeConversationCursor } from './conversation-cursor';
import { toConversationSummary, type ConversationSummary } from './conversation-summary';
import { inboxFilter } from './inbox-filter';
import {
  CONVERSATION_READ_MODEL,
  type ConversationReadModel,
} from './ports/conversation-read-model';

export interface ConversationPage {
  items: ConversationSummary[];
  nextCursor: string | null;
}

@Injectable()
export class ListConversationsUseCase {
  constructor(@Inject(CONVERSATION_READ_MODEL) private readonly readModel: ConversationReadModel) {}

  /** Lanza `InvalidCursorError` si el cursor no es válido e `InboxForbiddenError` si el rol no ve la bandeja. */
  async execute(
    actor: ActorContext,
    inbox: Inbox,
    cursor: string | undefined,
    limit: number,
    q?: string,
    channelId?: string,
  ): Promise<ConversationPage> {
    const filter = inboxFilter(actor, inbox, q, channelId);
    const after = cursor ? decodeConversationCursor(cursor) : null;
    const rows = await this.readModel.listSummaries(actor.tenantId, filter, after, limit + 1);

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(toConversationSummary),
      nextCursor: rows.length > limit && last ? encodeConversationCursor(last) : null,
    };
  }
}
