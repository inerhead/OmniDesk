import { Inject, Injectable } from '@nestjs/common';
import type { TenantContext } from '../../../shared/application/request-context';
import { isAiActive } from '../domain/conversation';
import { decodeConversationCursor, encodeConversationCursor } from './conversation-cursor';
import {
  CONVERSATION_READ_MODEL,
  type ConversationReadModel,
  type ConversationSummaryView,
} from './ports/conversation-read-model';

export interface ConversationSummary extends Omit<ConversationSummaryView, 'assignedAgentId'> {
  aiActive: boolean;
}

export interface ConversationPage {
  items: ConversationSummary[];
  nextCursor: string | null;
}

@Injectable()
export class ListConversationsUseCase {
  constructor(@Inject(CONVERSATION_READ_MODEL) private readonly readModel: ConversationReadModel) {}

  /** Lanza `InvalidCursorError` si el cursor no es válido. */
  async execute(
    tenant: TenantContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<ConversationPage> {
    const after = cursor ? decodeConversationCursor(cursor) : null;
    const rows = await this.readModel.listSummaries(tenant.tenantId, after, limit + 1);

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(({ assignedAgentId, ...summary }) => ({
        ...summary,
        aiActive: isAiActive({ status: summary.status, assignedAgentId }),
      })),
      nextCursor: rows.length > limit && last ? encodeConversationCursor(last) : null,
    };
  }
}
