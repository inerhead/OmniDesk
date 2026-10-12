import { Inject, Injectable } from '@nestjs/common';
import type { ActorContext } from '../../../shared/application/request-context';
import { can } from '../domain/conversation-policy';
import { toConversationSummary, type ConversationSummary } from './conversation-summary';
import {
  CONVERSATION_READ_MODEL,
  type ConversationReadModel,
} from './ports/conversation-read-model';

@Injectable()
export class GetConversationSummaryUseCase {
  constructor(@Inject(CONVERSATION_READ_MODEL) private readonly readModel: ConversationReadModel) {}

  /** `null` si la conversación no existe en el tenant o el actor no puede verla. */
  async execute(actor: ActorContext, conversationId: string): Promise<ConversationSummary | null> {
    const view = await this.readModel.getSummary(actor.tenantId, conversationId);
    if (!view) return null;
    const access = { status: view.status, assignedAgentId: view.assignedAgent?.id ?? null };
    return can(actor, 'view', access) ? toConversationSummary(view) : null;
  }
}
